#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════════
🚀 API REST PARA FACTURACIÓN ELECTRÓNICA DIAN - FACHO
═══════════════════════════════════════════════════════════════════════════════

Servicio FastAPI que expone la funcionalidad de facho-master para integración
con el backend Node.js del sistema SCRB.

Endpoints:
  POST /api/invoice/generate-and-send - Genera y envía factura a DIAN
  POST /api/invoice/generate-xml - Solo genera XML firmado
  GET /api/health - Verifica estado del servicio
  GET /api/certificate/status - Verifica certificado digital

Uso:
  uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload

═══════════════════════════════════════════════════════════════════════════════
"""

import sys
import os
import re
import base64
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, validator
import uvicorn
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.serialization import pkcs12

# Agregar el directorio raíz al path
sys.path.insert(0, os.path.dirname(__file__))

# Importar módulos de facho
from facho.fe.client import dian
from facho.fe.form_xml import DIANWriteSigned, DIANInvoiceXML
from facho import fe
from facho.fe import form

# ============================================================================
# MODELOS DE DATOS
# ============================================================================

class ItemFactura(BaseModel):
    """Item individual de la factura"""
    quantity: float = Field(..., description="Cantidad del producto/servicio")
    description: str = Field(..., description="Descripción del item")
    price: float = Field(..., description="Precio unitario")
    sku: Optional[str] = Field("ITEM", description="Código del producto")
    tax_percent: float = Field(0, description="Porcentaje de IVA (0, 5, 19)")

class DireccionFactura(BaseModel):
    """Dirección para facturación"""
    address: str = Field(..., description="Dirección completa")
    city: str = Field(..., description="Ciudad")
    city_code: str = Field("05001", description="Código DANE ciudad")
    department: str = Field(..., description="Departamento")
    department_code: str = Field("05", description="Código DANE departamento")
    country: str = Field("CO", description="Código país ISO")

class EmpresaFactura(BaseModel):
    """Datos de la empresa emisora"""
    nit: str = Field(..., description="NIT sin dígito de verificación")
    dv: str = Field(..., description="Dígito de verificación")
    razon_social: str = Field(..., description="Razón social completa")
    nombre_comercial: Optional[str] = Field(None, description="Nombre comercial")
    email: str = Field(..., description="Email de contacto")
    telefono: Optional[str] = Field(None, description="Teléfono de contacto")
    direccion: DireccionFactura = Field(..., description="Dirección fiscal")
    regimen: str = Field("48", description="Régimen tributario")
    responsabilidades: List[str] = Field(["O-13"], description="Responsabilidades fiscales")

class ClienteFactura(BaseModel):
    """Datos del cliente/beneficiario"""
    tipo_documento: str = Field(..., description="Tipo documento: DNI, CE, PASSPORT, FOREIGN_ID, NIT")
    numero_documento: str = Field(..., description="Número de documento")
    dv: Optional[str] = Field(None, description="Dígito verificación (solo para NIT)")
    nombre_completo: str = Field(..., description="Nombre completo o razón social")
    email: str = Field(..., description="Email del cliente")
    telefono: Optional[str] = Field(None, description="Teléfono del cliente")
    direccion: Optional[DireccionFactura] = Field(None, description="Dirección del cliente")
    tipo_persona: str = Field("2", description="1=Jurídica, 2=Natural")
    regimen: str = Field("R-99-PN", description="Régimen tributario del cliente")

class ConfiguracionDIAN(BaseModel):
    """Configuración DIAN para la facturación"""
    software_id: str = Field(..., description="ID del software registrado en DIAN")
    software_pin: str = Field(..., description="PIN del software")
    clave_tecnica: str = Field(..., description="Clave técnica del software")
    resolucion_numero: str = Field(..., description="Número de resolución")
    resolucion_prefijo: str = Field(..., description="Prefijo de facturación")
    resolucion_desde: int = Field(..., description="Rango desde")
    resolucion_hasta: int = Field(..., description="Rango hasta")
    resolucion_fecha_desde: str = Field(..., description="Fecha inicio resolución YYYY-MM-DD")
    resolucion_fecha_hasta: str = Field(..., description="Fecha fin resolución YYYY-MM-DD")
    ambiente: str = Field("habilitacion", description="habilitacion o produccion")

class SolicitudFactura(BaseModel):
    """Solicitud completa para generar factura"""
    empresa: EmpresaFactura
    cliente: ClienteFactura
    items: List[ItemFactura]
    configuracion_dian: ConfiguracionDIAN
    consecutivo: Optional[str] = Field(None, description="Consecutivo específico, si no se genera automático")
    forma_pago: str = Field("1", description="Código forma de pago (1=Contado)")
    medio_pago: str = Field("10", description="Código medio de pago (10=Efectivo)")
    notas: Optional[str] = Field(None, description="Notas adicionales")

class RespuestaFactura(BaseModel):
    """Respuesta de generación/envío de factura"""
    success: bool
    consecutivo: str
    cufe: Optional[str] = None
    xml_base64: Optional[str] = None
    zip_base64: Optional[str] = None
    dian_response: Optional[Dict[str, Any]] = None
    errors: Optional[List[str]] = None
    warnings: Optional[List[str]] = None

# ============================================================================
# APLICACIÓN FASTAPI
# ============================================================================

app = FastAPI(
    title="SCRB DIAN Electronic Invoice API",
    description="API para integración de facturación electrónica con DIAN Colombia",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configurar CORS — por defecto restringido a la red interna (backend CICANET).
# Sobrescribir con EINVOICE_CORS_ORIGINS (coma-separado) solo si se necesita.
_cors_origins = [o.strip() for o in os.getenv("EINVOICE_CORS_ORIGINS", "http://api:4000,http://localhost:4000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# Autenticación por API-key. El servicio NUNCA debe exponerse a internet; vive
# en la red interna de Docker. Aun así exige una clave compartida con el backend
# (header X-API-Key == EINVOICE_API_KEY). /api/health queda libre para healthcheck.
# Si EINVOICE_API_KEY no está configurada, el servicio rechaza todo (fail-closed).
# ----------------------------------------------------------------------------
EINVOICE_API_KEY = os.getenv("EINVOICE_API_KEY", "")
_PUBLIC_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}


@app.middleware("http")
async def _api_key_guard(request: Request, call_next):
    path = request.url.path
    if path in _PUBLIC_PATHS or request.method == "OPTIONS":
        return await call_next(request)
    if not EINVOICE_API_KEY:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"detail": "Servicio sin EINVOICE_API_KEY configurada (fail-closed)."})
    if request.headers.get("X-API-Key") != EINVOICE_API_KEY:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "API key inválida o ausente."})
    return await call_next(request)

# ============================================================================
# VARIABLES GLOBALES
# ============================================================================

CERT_BASE_PATH = Path(__file__).parent / "certificados"
CERT_BASE_PATH.mkdir(parents=True, exist_ok=True)  # Asegurar que exista al iniciar
CERT_PFX_PATH = CERT_BASE_PATH / "certificado_digital.pfx"
CERT_KEY_PATH = CERT_BASE_PATH / "llave_firma.pem"
CERT_CRT_PATH = CERT_BASE_PATH / "certificado_firma.pem"
CERT_PASSWORD = os.getenv("CERT_PASSWORD", "")

# ============================================================================
# FUNCIONES AUXILIARES
# ============================================================================

def mapear_tipo_documento(tipo: str) -> str:
    """Mapea tipos de documento a códigos DIAN"""
    mapeo = {
        'DNI': '13',
        'CC': '13',
        'CE': '22',
        'PASSPORT': '41',
        'FOREIGN_ID': '42',
        'NIT': '31'
    }
    return mapeo.get(tipo.upper(), '13')

def crear_factura_facho(solicitud: SolicitudFactura) -> form.Invoice:
    """
    Crea un objeto Invoice de facho con los datos de la solicitud
    """
    # Crear factura tipo 01 (Factura de Venta)
    inv = form.Invoice('01')
    
    # Periodo de facturación (fecha actual)
    now = datetime.now()
    inv.set_period(now, now)
    
    # Consecutivo
    if solicitud.consecutivo:
        consecutivo = solicitud.consecutivo
    else:
        # Generar consecutivo automático
        consecutivo = f"{solicitud.configuracion_dian.resolucion_prefijo}{int(datetime.now().timestamp())}"
    
    inv.invoice_ident = consecutivo
    
    # Configurar empresa (emisor)
    emp = solicitud.empresa
    inv.supplier_name = emp.razon_social
    inv.supplier_doc = emp.nit
    inv.supplier_check_digit = emp.dv
    inv.supplier_type_org = '1'  # Persona Jurídica
    inv.supplier_type_regime = emp.regimen
    inv.supplier_type_liability = emp.responsabilidades
    
    # Dirección empresa
    dir_emp = emp.direccion
    inv.supplier_address = dir_emp.address
    inv.supplier_city_code = dir_emp.city_code
    inv.supplier_city_name = dir_emp.city
    inv.supplier_department = dir_emp.department
    inv.supplier_department_code = dir_emp.department_code
    inv.supplier_country_code = dir_emp.country
    inv.supplier_email = emp.email
    if emp.telefono:
        inv.supplier_phone = emp.telefono
    
    # Configurar cliente
    cli = solicitud.cliente
    inv.customer_name = cli.nombre_completo
    inv.customer_doc = cli.numero_documento
    inv.customer_doc_type = mapear_tipo_documento(cli.tipo_documento)
    
    if cli.dv:
        inv.customer_check_digit = cli.dv
    
    inv.customer_type_org = cli.tipo_persona
    inv.customer_type_regime = cli.regimen
    inv.customer_type_liability = ['R-99-PN']
    inv.customer_email = cli.email
    
    if cli.telefono:
        inv.customer_phone = cli.telefono
    
    # Dirección cliente
    if cli.direccion:
        dir_cli = cli.direccion
        inv.customer_address = dir_cli.address
        inv.customer_city_code = dir_cli.city_code
        inv.customer_city_name = dir_cli.city
        inv.customer_department = dir_cli.department
        inv.customer_department_code = dir_cli.department_code
        inv.customer_country_code = dir_cli.country
    else:
        # Usar dirección de la empresa por defecto
        inv.customer_address = dir_emp.address
        inv.customer_city_code = dir_emp.city_code
        inv.customer_city_name = dir_emp.city
        inv.customer_department = dir_emp.department
        inv.customer_department_code = dir_emp.department_code
        inv.customer_country_code = dir_emp.country
    
    # Forma y medio de pago
    inv.payment_means = solicitud.medio_pago
    inv.payment_form = solicitud.forma_pago
    
    # Agregar items
    for idx, item in enumerate(solicitud.items, start=1):
        line = form.InvoiceLine()
        line.line_num = str(idx)
        line.quantity = item.quantity
        line.description = item.description
        line.price = item.price
        line.code = item.sku or f"ITEM{idx}"
        
        # Impuestos
        if item.tax_percent > 0:
            tax = form.InvoiceLineTax()
            tax.tax_amount = (item.quantity * item.price * item.tax_percent / 100)
            tax.taxable_amount = item.quantity * item.price
            tax.tax_percent = item.tax_percent
            line.tax_totals.append(tax)
        
        inv.lines.append(line)
    
    # Notas adicionales
    if solicitud.notas:
        inv.notes = [solicitud.notas]
    
    # Calcular totales
    inv.calculate()
    
    return inv

def crear_extensiones_dian(inv: form.Invoice, config: ConfiguracionDIAN, empresa: EmpresaFactura):
    """
    Crea las extensiones XML requeridas por la DIAN
    """
    # Determinar ambiente
    ambiente = fe.AMBIENTE_PRODUCCION if config.ambiente.lower() == 'produccion' else fe.AMBIENTE_PRUEBAS
    
    # Security Code
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        config.software_id,
        config.software_pin,
        inv.invoice_ident
    )
    
    # Authorization Provider
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    # CUFE
    cufe = fe.DianXMLExtensionCUFE(
        inv,
        config.clave_tecnica,
        ambiente
    )
    
    # Software Provider
    software_provider = fe.DianXMLExtensionSoftwareProvider(
        empresa.nit,
        empresa.dv,
        config.software_id
    )
    
    # Invoice Authorization
    fecha_desde = datetime.strptime(config.resolucion_fecha_desde, '%Y-%m-%d')
    fecha_hasta = datetime.strptime(config.resolucion_fecha_hasta, '%Y-%m-%d')
    
    inv_authorization = fe.DianXMLExtensionInvoiceAuthorization(
        config.resolucion_numero,
        fecha_desde,
        fecha_hasta,
        config.resolucion_prefijo,
        config.resolucion_desde,
        config.resolucion_hasta
    )
    
    return [security_code, authorization_provider, cufe, software_provider, inv_authorization]

def verificar_certificado() -> Dict[str, Any]:
    """Verifica que el certificado esté disponible"""
    resultado = {
        "pfx_exists": CERT_PFX_PATH.exists(),
        "key_exists": CERT_KEY_PATH.exists(),
        "crt_exists": CERT_CRT_PATH.exists(),
        "pfx_path": str(CERT_PFX_PATH),
        "key_path": str(CERT_KEY_PATH),
        "crt_path": str(CERT_CRT_PATH)
    }
    return resultado

# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Verifica que el servicio esté activo"""
    return {
        "status": "healthy",
        "service": "SCRB DIAN API",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/certificate/status")
async def certificate_status():
    """Verifica el estado de los certificados"""
    cert_info = verificar_certificado()
    
    if not cert_info["pfx_exists"] and not (cert_info["key_exists"] and cert_info["crt_exists"]):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Certificados no encontrados. Configure los certificados en la carpeta 'certificados/'"
        )
    
    return {
        "status": "ok",
        "certificates": cert_info
    }

@app.post("/api/invoice/generate-xml", response_model=RespuestaFactura)
async def generate_xml(solicitud: SolicitudFactura):
    """
    Genera el XML firmado de la factura sin enviarlo a DIAN
    """
    try:
        # Verificar certificado
        cert_info = verificar_certificado()
        if not cert_info["pfx_exists"]:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Certificado PFX no encontrado"
            )
        
        # Crear factura
        inv = crear_factura_facho(solicitud)
        
        # Generar XML
        xml = DIANInvoiceXML(inv)
        
        # Agregar extensiones
        extensiones = crear_extensiones_dian(inv, solicitud.configuracion_dian, solicitud.empresa)
        for extension in extensiones:
            xml.add_extension(extension)
        
        # Firmar y guardar en archivo temporal
        with tempfile.NamedTemporaryFile(mode='w', suffix='.xml', delete=False) as tmp_xml:
            xml_path = tmp_xml.name
        
        DIANWriteSigned(xml, xml_path, str(CERT_PFX_PATH), CERT_PASSWORD, use_cache_policy=False)
        
        # Leer XML firmado
        with open(xml_path, 'rb') as f:
            xml_content = f.read()
        
        xml_base64 = base64.b64encode(xml_content).decode('utf-8')
        
        # Extraer CUFE del objeto factura
        cufe = getattr(inv, 'cufe', None) or "CUFE_NO_CALCULADO"
        
        # Limpiar archivo temporal
        os.unlink(xml_path)
        
        return RespuestaFactura(
            success=True,
            consecutivo=inv.invoice_ident,
            cufe=cufe,
            xml_base64=xml_base64
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generando XML: {str(e)}"
        )

@app.post("/api/invoice/generate-and-send", response_model=RespuestaFactura)
async def generate_and_send(solicitud: SolicitudFactura):
    """
    Genera la factura, firma el XML y lo envía a la DIAN
    """
    try:
        # Verificar certificados
        cert_info = verificar_certificado()
        if not cert_info["pfx_exists"] or not cert_info["key_exists"] or not cert_info["crt_exists"]:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Certificados incompletos. Se requieren: certificado_digital.pfx, llave_firma.pem y certificado_firma.pem"
            )
        
        # Crear factura
        inv = crear_factura_facho(solicitud)
        
        # Generar XML
        xml = DIANInvoiceXML(inv)
        
        # Agregar extensiones
        extensiones = crear_extensiones_dian(inv, solicitud.configuracion_dian, solicitud.empresa)
        for extension in extensiones:
            xml.add_extension(extension)
        
        # Firmar y guardar en archivo temporal
        with tempfile.NamedTemporaryFile(mode='w', suffix='.xml', delete=False) as tmp_xml:
            xml_path = tmp_xml.name
        
        DIANWriteSigned(xml, xml_path, str(CERT_PFX_PATH), CERT_PASSWORD, use_cache_policy=False)
        
        # Crear ZIP
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp_zip:
            zip_path = tmp_zip.name
        
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_path, f'factura_{inv.invoice_ident}.xml')
        
        # Leer archivos
        with open(xml_path, 'rb') as f:
            xml_content = f.read()
        
        with open(zip_path, 'rb') as f:
            zip_content = f.read()
        
        xml_base64 = base64.b64encode(xml_content).decode('utf-8')
        zip_base64 = base64.b64encode(zip_content).decode('utf-8')
        
        # Enviar a DIAN
        client = dian.DianSignatureClient(
            str(CERT_KEY_PATH),
            str(CERT_CRT_PATH),
            password=None
        )
        
        # Seleccionar ambiente
        if solicitud.configuracion_dian.ambiente.lower() == 'produccion':
            servicio = dian.Produccion.SendBillSync
        else:
            servicio = dian.Habilitacion.SendBillSync
        
        response = client.request(
            servicio(
                f'factura_{inv.invoice_ident}.zip',
                zip_base64
            )
        )
        
        # Procesar respuesta
        dian_response = {}
        errors = []
        warnings = []
        
        for attr in dir(response):
            if not attr.startswith('_') and not callable(getattr(response, attr)):
                value = getattr(response, attr, None)
                if value is not None:
                    dian_response[attr] = str(value) if not isinstance(value, (str, int, float, bool, list, dict)) else value
        
        # Analizar errores
        if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
            error_obj = response.ErrorMessage
            if hasattr(error_obj, 'string'):
                error_list = error_obj.string if isinstance(error_obj.string, list) else [error_obj.string]
                for error in error_list:
                    # Clasificar entre errores y advertencias
                    if 'Notificación' in error or 'FAJ' in error:
                        warnings.append(error)
                    else:
                        errors.append(error)
        
        is_valid = getattr(response, 'IsValid', False)
        status_code = getattr(response, 'StatusCode', None)
        
        # Extraer CUFE
        cufe = getattr(response, 'XmlDocumentKey', None) or getattr(inv, 'cufe', 'CUFE_NO_DISPONIBLE')
        
        # Actualizar archivo de consecutivos si la factura fue exitosa
        # NOTA: Los consecutivos ahora se guardan por NIT en certificados/{NIT}/.ultimo_consecutivo_factura.txt
        # El endpoint /api/pruebas/enviar y los scripts de envío ya manejan esto correctamente
        if is_valid and status_code == '00':
            try:
                consecutivo_num = int(inv.invoice_ident.replace(solicitud.configuracion_dian.resolucion_prefijo, ''))
                # Guardar en archivo por NIT
                empresa_nit = solicitud.empresa.nit
                consecutivo_file = Path(__file__).parent / "certificados" / empresa_nit / ".ultimo_consecutivo_factura.txt"
                consecutivo_file.parent.mkdir(parents=True, exist_ok=True)
                with open(consecutivo_file, 'w') as f:
                    f.write(str(consecutivo_num))
                print(f"✅ Consecutivo {consecutivo_num} guardado para NIT {empresa_nit}")
            except (ValueError, Exception) as e:
                # No fallar si no se puede actualizar el consecutivo
                print(f"Advertencia: No se pudo actualizar consecutivo: {e}")
        
        # Limpiar archivos temporales
        os.unlink(xml_path)
        os.unlink(zip_path)
        
        return RespuestaFactura(
            success=is_valid and status_code == '00',
            consecutivo=inv.invoice_ident,
            cufe=cufe,
            xml_base64=xml_base64,
            zip_base64=zip_base64,
            dian_response=dian_response,
            errors=errors if errors else None,
            warnings=warnings if warnings else None
        )
        
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error procesando factura: {str(e)}\n{traceback.format_exc()}"
        )

# ============================================================================
# ENDPOINTS PARA VALIDACIÓN DE CERTIFICADOS CERTICÁMARA
# ============================================================================

# Variable global para almacenar archivos temporalmente (en producción usar Redis/DB)
archivos_certificados_temp = {}

@app.post("/api/config/certificado-validar-certicamara")
async def validar_certificados_certicamara(
    request: Request,  # Debe ser el primer parámetro para que FastAPI lo inyecte
    archivo_pfx: UploadFile = File(...),
    archivo_cer: UploadFile = File(...),
    archivo_key: UploadFile = File(...),
    password: str = Form(...)
):
    """
    Valida los 3 archivos de Certicámara (PFX, CER, KEY) y verifica correspondencia
    Si se proporciona company_nit (via header X-Company-Nit), guarda los archivos en certificados/{NIT}/
    """
    try:
        # DEBUG: Crear archivo de prueba para verificar que el código se ejecuta
        test_file = Path(__file__).parent / "certificados" / "test_execution.txt"
        with open(test_file, 'a') as f:
            from datetime import datetime
            f.write(f"{datetime.now()}: Endpoint ejecutado\n")
        
        # Leer company_nit del header
        company_nit = request.headers.get('X-Company-Nit', '')
        
        # DEBUG: Guardar en archivo para persistir el log (en volumen persistente)
        debug_file = Path(__file__).parent / "certificados" / "debug_company_nit.txt"
        with open(debug_file, 'a') as f:
            f.write(f"{datetime.now()}: company_nit='{company_nit}', len={len(company_nit)}, bool={bool(company_nit)}, headers={dict(request.headers)}\n")
        
        import logging
        logger = logging.getLogger("uvicorn")
        logger.info(f"🔍 company_nit recibido del header: '{company_nit}' (tipo: {type(company_nit).__name__}, len: {len(company_nit)})")
        
        # Leer contenidos de los archivos
        pfx_content = await archivo_pfx.read()
        cer_content = await archivo_cer.read()
        key_content = await archivo_key.read()
        
        # Validar PFX - intentar abrirlo con la contraseña
        try:
            private_key_pfx, cert_pfx, additional_certs = pkcs12.load_key_and_certificates(
                pfx_content,
                password.encode('utf-8'),
                backend=default_backend()
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Error al abrir PFX: {str(e)}. Verifica la contraseña."
            )
        
        if not private_key_pfx or not cert_pfx:
            raise HTTPException(
                status_code=400,
                detail="El archivo PFX no contiene certificado o llave privada válidos"
            )
        
        # Validar certificado CER
        try:
            cert_cer = x509.load_pem_x509_certificate(cer_content, default_backend())
        except:
            try:
                cert_cer = x509.load_der_x509_certificate(cer_content, default_backend())
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Error al leer certificado CER: {str(e)}. Formato inválido."
                )
        
        # Validar llave privada KEY
        try:
            private_key_key = serialization.load_pem_private_key(
                key_content,
                password=None,  # Certicámara envía la KEY sin contraseña
                backend=default_backend()
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Error al leer llave privada KEY: {str(e)}. Formato inválido."
            )
        
        # Verificar correspondencia - comparar números públicos
        public_key_pfx = cert_pfx.public_key().public_numbers()
        public_key_cer = cert_cer.public_key().public_numbers()
        public_key_from_private = private_key_key.public_key().public_numbers()
        
        if public_key_pfx != public_key_cer:
            raise HTTPException(
                status_code=400,
                detail="El certificado en el PFX no coincide con el certificado CER"
            )
        
        if public_key_pfx != public_key_from_private:
            raise HTTPException(
                status_code=400,
                detail="La llave privada KEY no corresponde al certificado PFX"
            )
        
        # Extraer información del certificado
        subject = cert_pfx.subject.rfc4514_string()
        issuer = cert_pfx.issuer.rfc4514_string()
        
        # Compatibilidad con diferentes versiones de cryptography
        try:
            not_before = cert_pfx.not_valid_before_utc.strftime('%Y-%m-%d %H:%M:%S UTC')
            not_after = cert_pfx.not_valid_after_utc.strftime('%Y-%m-%d %H:%M:%S UTC')
            vigente = datetime.now(timezone.utc) < cert_pfx.not_valid_after_utc
        except AttributeError:
            # Versiones antiguas de cryptography usan not_valid_before/not_valid_after
            not_before = cert_pfx.not_valid_before.strftime('%Y-%m-%d %H:%M:%S UTC')
            not_after = cert_pfx.not_valid_after.strftime('%Y-%m-%d %H:%M:%S UTC')
            # Asegurar que las fechas tengan timezone
            if cert_pfx.not_valid_after.tzinfo is None:
                from datetime import timezone as tz
                vigente = datetime.now(tz.utc) < cert_pfx.not_valid_after.replace(tzinfo=tz.utc)
            else:
                vigente = datetime.now(timezone.utc) < cert_pfx.not_valid_after
        
        # Obtener información de la clave
        key_size = private_key_pfx.key_size
        key_type = "RSA"
        
        # Convertir CER a PEM si es necesario
        cert_pem = cert_cer.public_bytes(encoding=serialization.Encoding.PEM)
        
        # Convertir KEY a PEM si es necesario
        key_pem = private_key_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        )
        
        # Guardar el PFX temporalmente en disco
        import tempfile
        temp_dir = Path(tempfile.gettempdir()) / "facho_cert_temp"
        temp_dir.mkdir(exist_ok=True)
        
        session_id = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        pfx_temp_path = temp_dir / f"{session_id}_certificado_digital.pfx"
        pfx_temp_path.write_bytes(pfx_content)
        
        # Guardar archivos temporalmente para descarga posterior
        archivos_certificados_temp[session_id] = {
            'cer': cert_pem,
            'key': key_pem,
            'pfx_path': str(pfx_temp_path),
            'pfx_password': password,
            'timestamp': datetime.now()
        }
        
        # Si se proporciona company_nit, guardar archivos INMEDIATAMENTE en carpeta de empresa
        if company_nit and company_nit.strip():
            cert_dir = Path(__file__).parent / "certificados" / company_nit
            cert_dir.mkdir(parents=True, exist_ok=True)
            
            # Guardar archivos PEM
            cert_pem_path = cert_dir / "certificado_firma.pem"
            key_pem_path = cert_dir / "llave_firma.pem"
            pfx_dest_path = cert_dir / "certificado_digital.pfx"
            
            cert_pem_path.write_bytes(cert_pem)
            key_pem_path.write_bytes(key_pem)
            pfx_dest_path.write_bytes(pfx_content)
            
            print(f"✅ Archivos guardados para empresa {company_nit}:")
            print(f"   - {cert_pem_path}")
            print(f"   - {key_pem_path}")
            print(f"   - {pfx_dest_path}")
        
        # Limpiar archivos antiguos (más de 10 minutos)
        for sid in list(archivos_certificados_temp.keys()):
            if (datetime.now() - archivos_certificados_temp[sid]['timestamp']).seconds > 600:
                del archivos_certificados_temp[sid]
        
        return {
            "success": True,
            "session_id": session_id,
            "pfx_ruta_temp": str(pfx_temp_path),
            "info_certificado": {
                "subject": subject,
                "issuer": issuer,
                "valido_desde": not_before,
                "valido_hasta": not_after,
                "vigente": vigente,
                "tipo_clave": key_type,
                "tamano_clave": key_size
            },
            "archivos": [
                {
                    "nombre": "certificado_firma.pem",
                    "tipo": "cer",
                    "descripcion": "Certificado público para mTLS con DIAN"
                },
                {
                    "nombre": "llave_firma.pem",
                    "tipo": "key",
                    "descripcion": "Llave privada para mTLS con DIAN"
                }
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Error validando certificados: {str(e)}\n{traceback.format_exc()}"
        )

@app.get("/api/config/certificado-descargar/{session_id}/{tipo}")
async def descargar_certificado(session_id: str, tipo: str):
    """
    Descarga uno de los archivos de certificado validados
    """
    if session_id not in archivos_certificados_temp:
        raise HTTPException(
            status_code=404,
            detail="Sesión expirada o no encontrada. Por favor valida los certificados nuevamente."
        )
    
    archivos = archivos_certificados_temp[session_id]
    
    if tipo not in ['pfx', 'cer', 'key']:
        raise HTTPException(
            status_code=400,
            detail="Tipo inválido. Debe ser: pfx, cer o key"
        )
    
    contenido = archivos[tipo]
    nombres = {
        'pfx': 'certificado_digital.pfx',
        'cer': 'certificado_firma.pem',
        'key': 'llave_firma.pem'
    }
    
    # Guardar temporalmente para enviar
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=f'.{tipo}')
    temp_file.write(contenido)
    temp_file.close()
    
    return FileResponse(
        temp_file.name,
        media_type='application/octet-stream',
        filename=nombres[tipo]
    )

@app.post("/api/config/certificado-autoconfigurar")
async def certificado_autoconfigurar(data: dict):
    """
    Auto-configura los certificados generados (PFX + 2 PEM) en el sistema
    Guarda los archivos y actualiza config_dian.py con las rutas correctas
    Soporta multi-empresa: guarda en certificados/{NIT}/ si se proporciona company_nit
    """
    try:
        session_id = data.get('session_id')
        pfx_ruta = data.get('pfx_ruta')  # Ruta del PFX ya subido
        pfx_password = data.get('pfx_password')  # Contraseña del PFX
        company_nit = data.get('company_nit')  # NIT de la empresa (opcional)
        
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id es requerido")
        
        if not pfx_ruta:
            raise HTTPException(status_code=400, detail="pfx_ruta es requerida. Debes subir el archivo PFX primero")
        
        if not pfx_password:
            raise HTTPException(status_code=400, detail="pfx_password es requerida")
        
        # Obtener los archivos PEM temporales generados
        temp_data = archivos_certificados_temp.get(session_id)
        if not temp_data:
            raise HTTPException(
                status_code=404,
                detail="Sesión expirada o no encontrada. Por favor genera los certificados PEM nuevamente."
            )
        
        # Directorio de certificados - usar carpeta específica por empresa si se proporciona NIT
        if company_nit:
            cert_dir = Path(__file__).parent / "certificados" / company_nit
            print(f"📁 Guardando certificados para empresa {company_nit} en: {cert_dir}")
        else:
            cert_dir = Path(__file__).parent / "certificados"
            print(f"📁 Guardando certificados en carpeta global: {cert_dir}")
        
        cert_dir.mkdir(parents=True, exist_ok=True)
        
        # === PASO 1: Guardar los 2 archivos PEM generados ===
        cert_pem_path = cert_dir / "certificado_firma.pem"
        key_pem_path = cert_dir / "llave_firma.pem"
        
        # Los PEM son bytes, necesitamos guardarlos como bytes
        cert_pem_path.write_bytes(temp_data['cer'])
        key_pem_path.write_bytes(temp_data['key'])
        
        # === PASO 2: Copiar el PFX a la carpeta certificados (si no está ahí) ===
        pfx_source = Path(pfx_ruta)
        pfx_dest = cert_dir / "certificado_digital.pfx"
        
        # Si el PFX está en otra ubicación, copiarlo
        if pfx_source.resolve() != pfx_dest.resolve():
            import shutil
            shutil.copy2(pfx_source, pfx_dest)
        
        # === PASO 3: Validar que los 3 archivos existen y son accesibles ===
        archivos_validados = []
        errores = []
        
        # Validar PFX
        if pfx_dest.exists() and pfx_dest.stat().st_size > 0:
            archivos_validados.append({
                "archivo": "certificado_digital.pfx",
                "ruta": str(pfx_dest),
                "tamano": pfx_dest.stat().st_size,
                "tipo": "PKCS#12",
                "uso": "Firma XAdES del XML"
            })
        else:
            errores.append("certificado_digital.pfx no existe o está vacío")
        
        # Validar certificado_firma.pem
        if cert_pem_path.exists() and cert_pem_path.stat().st_size > 0:
            archivos_validados.append({
                "archivo": "certificado_firma.pem",
                "ruta": str(cert_pem_path),
                "tamano": cert_pem_path.stat().st_size,
                "tipo": "PEM (Certificado)",
                "uso": "mTLS con DIAN (certificado público)"
            })
        else:
            errores.append("certificado_firma.pem no existe o está vacío")
        
        # Validar llave_firma.pem
        if key_pem_path.exists() and key_pem_path.stat().st_size > 0:
            archivos_validados.append({
                "archivo": "llave_firma.pem",
                "ruta": str(key_pem_path),
                "tamano": key_pem_path.stat().st_size,
                "tipo": "PEM (Clave Privada)",
                "uso": "mTLS con DIAN (clave privada)"
            })
        else:
            errores.append("llave_firma.pem no existe o está vacío")
        
        if errores:
            raise HTTPException(
                status_code=500,
                detail=f"Error validando archivos: {', '.join(errores)}"
            )
        
        # === PASO 4: Actualizar config_dian.py con las rutas correctas ===
        config_dian_path = Path(__file__).parent / "config_dian.py"
        
        # Leer el archivo actual
        if config_dian_path.exists():
            with open(config_dian_path, 'r', encoding='utf-8') as f:
                dian_content = f.read()
            
            # Actualizar la ruta del certificado PFX
            import re
            dian_content = re.sub(
                r"CERTIFICADO_PATH = ['\"].*?['\"]",
                f"CERTIFICADO_PATH = '{pfx_dest}'",
                dian_content
            )
            
            # Actualizar la contraseña
            dian_content = re.sub(
                r"CERTIFICADO_PASSWORD = ['\"].*?['\"]",
                f"CERTIFICADO_PASSWORD = '{pfx_password}'",
                dian_content
            )
            
            # Guardar
            with open(config_dian_path, 'w', encoding='utf-8') as f:
                f.write(dian_content)
        
        # === PASO 5: Limpiar sesión temporal ===
        del archivos_certificados_temp[session_id]
        
        return {
            "success": True,
            "message": "✅ Certificados configurados automáticamente en el sistema",
            "archivos_configurados": archivos_validados,
            "rutas": {
                "certificado_pfx": str(pfx_dest),
                "certificado_pem": str(cert_pem_path),
                "llave_pem": str(key_pem_path)
            },
            "config_actualizado": str(config_dian_path)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Error en auto-configuración: {str(e)}\n{traceback.format_exc()}"
        )

@app.post("/api/config/certificado-validar-completo")
async def validar_certificado_completo(data: dict = None):
    """
    Validación COMPLETA de certificados configurados en el sistema:
    1. Descarga cadena de certificación de Certicámara
    2. Extrae información completa del certificado (incluye rep. legal, extensiones X.509)
    3. Verifica correspondencia certificado-llave privada
    4. Valida cadena de confianza completa
    
    Soporta multi-empresa: busca en certificados/{NIT}/ si se proporciona company_nit
    
    NO valida: MAC del PFX (no crítico), OCSP (no confiable para certificados recientes)
    """
    import subprocess
    import tempfile
    import requests
    from datetime import datetime as dt
    
    try:
        import config_dian
        from importlib import reload
        reload(config_dian)
        
        # Obtener NIT de la empresa si se proporciona
        company_nit = data.get('company_nit') if data else None
        
        # Rutas de certificados - usar carpeta específica por empresa si se proporciona NIT
        if company_nit:
            cert_dir = Path(__file__).parent / "certificados" / company_nit
            print(f"📁 Validando certificados de empresa {company_nit} en: {cert_dir}")
        else:
            cert_dir = Path(__file__).parent / "certificados"
            print(f"📁 Validando certificados en carpeta global: {cert_dir}")
        
        pfx_path = cert_dir / "certificado_digital.pfx"
        pfx_password = config_dian.CERTIFICADO_PASSWORD
        cert_pem_path = cert_dir / "certificado_firma.pem"
        key_pem_path = cert_dir / "llave_firma.pem"
        
        # Validar que existan los archivos
        errores = []
        if not pfx_path.exists():
            errores.append(f"Archivo PFX no encontrado: {pfx_path}")
        if not cert_pem_path.exists():
            errores.append(f"Certificado PEM no encontrado: {cert_pem_path}")
        if not key_pem_path.exists():
            errores.append(f"Llave PEM no encontrada: {key_pem_path}")
            
        if errores:
            raise HTTPException(status_code=404, detail="\n".join(errores))
        
        resultado = {
            "validaciones": [],
            "info_certificado": {},
            "advertencias": [],
            "errores": []
        }
        
        # === 1. DESCARGAR CADENA DE CERTIFICACIÓN ===
        try:
            ac_raiz_url = "https://www.certicamara.com/repositoriorevocaciones/ac_offline_raiz_certicamara_.cer"
            ac_sub_url = "https://www.certicamara.com/repositoriorevocaciones/ac_online_subordinada4096_certicamara_.crt"
            
            ac_raiz_der = cert_dir / "AC_RAIZ_CERTICAMARA.cer"
            ac_sub_der = cert_dir / "AC_SUBORDINADA_4096_CERTICAMARA.crt"
            ac_raiz_pem = cert_dir / "AC_RAIZ_CERTICAMARA.pem"
            ac_sub_pem = cert_dir / "AC_SUBORDINADA_4096_CERTICAMARA.pem"
            
            # Descargar
            response = requests.get(ac_raiz_url, timeout=10)
            ac_raiz_der.write_bytes(response.content)
            
            response = requests.get(ac_sub_url, timeout=10)
            ac_sub_der.write_bytes(response.content)
            
            # Convertir DER → PEM
            subprocess.run([
                "openssl", "x509", "-inform", "DER", "-in", str(ac_raiz_der),
                "-outform", "PEM", "-out", str(ac_raiz_pem)
            ], check=True, capture_output=True)
            
            subprocess.run([
                "openssl", "x509", "-inform", "DER", "-in", str(ac_sub_der),
                "-outform", "PEM", "-out", str(ac_sub_pem)
            ], check=True, capture_output=True)
            
            resultado["validaciones"].append({
                "paso": "Descarga de Cadena de Certificación",
                "estado": "exitoso",
                "mensaje": "Cadena de Certicámara descargada y convertida"
            })
        except Exception as e:
            resultado["validaciones"].append({
                "paso": "Descarga de Cadena de Certificación",
                "estado": "error",
                "mensaje": f"Error descargando cadena: {str(e)}"
            })
            resultado["errores"].append(str(e))
        
        # === 2. EXTRAER INFORMACIÓN COMPLETA DEL CERTIFICADO ===
        try:
            from cryptography.x509.oid import ExtensionOID, NameOID
            cert = x509.load_pem_x509_certificate(cert_pem_path.read_bytes(), default_backend())
            
            # Subject - Extracción completa
            subject_attrs = {}
            for attr in cert.subject:
                subject_attrs[attr.oid._name] = attr.value
            
            # Issuer - Extracción completa
            issuer_attrs = {}
            for attr in cert.issuer:
                issuer_attrs[attr.oid._name] = attr.value
            
            # Fechas - Compatibilidad con diferentes versiones de cryptography
            try:
                not_before = cert.not_valid_before_utc
                not_after = cert.not_valid_after_utc
            except AttributeError:
                # Versiones antiguas de cryptography
                not_before = cert.not_valid_before
                not_after = cert.not_valid_after
                # Asegurar timezone
                if not_before.tzinfo is None:
                    not_before = not_before.replace(tzinfo=timezone.utc)
                if not_after.tzinfo is None:
                    not_after = not_after.replace(tzinfo=timezone.utc)
            
            ahora = dt.now(timezone.utc)
            vigente = not_before <= ahora <= not_after
            dias_restantes = (not_after - ahora).days
            
            # Serial
            serial = hex(cert.serial_number)[2:].upper()
            
            # === EXTENSIONES X.509 ===
            extensiones = {}
            
            # Subject Alternative Name (SAN) - Puede contener correos, nombres adicionales
            try:
                san = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
                san_valores = []
                for nombre in san.value:
                    try:
                        san_valores.append(str(nombre.value))
                    except:
                        san_valores.append(str(nombre))
                extensiones['subject_alternative_name'] = san_valores
            except:
                extensiones['subject_alternative_name'] = []
            
            # Key Usage
            try:
                ku = cert.extensions.get_extension_for_oid(ExtensionOID.KEY_USAGE)
                key_usage = []
                if ku.value.digital_signature: key_usage.append("Firma Digital")
                if ku.value.content_commitment: key_usage.append("No Repudio")
                if ku.value.key_encipherment: key_usage.append("Cifrado de Claves")
                if ku.value.data_encipherment: key_usage.append("Cifrado de Datos")
                if ku.value.key_agreement: key_usage.append("Acuerdo de Claves")
                if ku.value.key_cert_sign: key_usage.append("Firma de Certificados")
                if ku.value.crl_sign: key_usage.append("Firma de CRL")
                extensiones['key_usage'] = key_usage
            except:
                extensiones['key_usage'] = []
            
            # Extended Key Usage
            try:
                eku = cert.extensions.get_extension_for_oid(ExtensionOID.EXTENDED_KEY_USAGE)
                ext_key_usage = []
                for uso in eku.value:
                    nombre = uso._name if hasattr(uso, '_name') else str(uso.dotted_string)
                    ext_key_usage.append(nombre)
                extensiones['extended_key_usage'] = ext_key_usage
            except:
                extensiones['extended_key_usage'] = []
            
            # Certificate Policies - Puede contener info de políticas de Certicámara
            try:
                cp = cert.extensions.get_extension_for_oid(ExtensionOID.CERTIFICATE_POLICIES)
                politicas = []
                for policy in cp.value:
                    politica_info = {
                        'oid': policy.policy_identifier.dotted_string,
                        'qualifiers': []
                    }
                    if policy.policy_qualifiers:
                        for qualifier in policy.policy_qualifiers:
                            if isinstance(qualifier, str):
                                politica_info['qualifiers'].append(qualifier)
                            elif hasattr(qualifier, 'notice_reference') or hasattr(qualifier, 'explicit_text'):
                                if hasattr(qualifier, 'explicit_text'):
                                    politica_info['qualifiers'].append(str(qualifier.explicit_text))
                    politicas.append(politica_info)
                extensiones['certificate_policies'] = politicas
            except:
                extensiones['certificate_policies'] = []
            
            # CRL Distribution Points
            try:
                crl = cert.extensions.get_extension_for_oid(ExtensionOID.CRL_DISTRIBUTION_POINTS)
                crl_urls = []
                for punto in crl.value:
                    if punto.full_name:
                        for nombre in punto.full_name:
                            crl_urls.append(str(nombre.value))
                extensiones['crl_distribution_points'] = crl_urls
            except:
                extensiones['crl_distribution_points'] = []
            
            # Authority Information Access (AIA) - OCSP y CA Issuers
            try:
                aia = cert.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_INFORMATION_ACCESS)
                aia_info = {'ocsp': [], 'ca_issuers': []}
                for desc in aia.value:
                    if desc.access_method._name == 'OCSP':
                        aia_info['ocsp'].append(str(desc.access_location.value))
                    elif desc.access_method._name == 'caIssuers':
                        aia_info['ca_issuers'].append(str(desc.access_location.value))
                extensiones['authority_info_access'] = aia_info
            except:
                extensiones['authority_info_access'] = {'ocsp': [], 'ca_issuers': []}
            
            resultado["info_certificado"] = {
                "titular": {
                    "nombre_comun": subject_attrs.get('commonName', 'N/A'),
                    "organizacion": subject_attrs.get('organizationName', 'N/A'),
                    "unidad_organizacional": subject_attrs.get('organizationalUnitName', 'N/A'),
                    "serial_number": subject_attrs.get('serialNumber', 'N/A'),
                    "pais": subject_attrs.get('countryName', 'N/A'),
                    "estado": subject_attrs.get('stateOrProvinceName', 'N/A'),
                    "ciudad": subject_attrs.get('localityName', 'N/A'),
                    "email": subject_attrs.get('emailAddress', 'N/A'),
                    "titulo": subject_attrs.get('title', 'N/A'),
                    "nombre": subject_attrs.get('givenName', 'N/A'),
                    "apellido": subject_attrs.get('surname', 'N/A'),
                    "nombre_completo": f"{subject_attrs.get('givenName', '')} {subject_attrs.get('surname', '')}".strip() or 'N/A'
                },
                "emisor": {
                    "nombre": issuer_attrs.get('commonName', 'N/A'),
                    "organizacion": issuer_attrs.get('organizationName', 'N/A'),
                    "unidad_organizacional": issuer_attrs.get('organizationalUnitName', 'N/A'),
                    "pais": issuer_attrs.get('countryName', 'N/A')
                },
                "validez": {
                    "emision": not_before.strftime('%Y-%m-%d %H:%M:%S UTC'),
                    "vencimiento": not_after.strftime('%Y-%m-%d %H:%M:%S UTC'),
                    "vigente": vigente,
                    "dias_restantes": dias_restantes
                },
                "tecnico": {
                    "serial": serial,
                    "version": cert.version.name,
                    "algoritmo_firma": cert.signature_algorithm_oid._name,
                    "algoritmo_clave_publica": cert.public_key().__class__.__name__.replace('PublicKey', ''),
                    "tamaño_clave_bits": cert.public_key().key_size,
                    "fingerprint_sha256": cert.fingerprint(hashes.SHA256()).hex().upper(),
                    "fingerprint_sha1": cert.fingerprint(hashes.SHA1()).hex().upper()
                },
                "extensiones": extensiones
            }
            
            if vigente:
                if dias_restantes < 30:
                    resultado["advertencias"].append(f"⚠️ Certificado vence en {dias_restantes} días")
                resultado["validaciones"].append({
                    "paso": "Vigencia del Certificado",
                    "estado": "exitoso",
                    "mensaje": f"✅ Certificado vigente ({dias_restantes} días restantes)"
                })
            else:
                resultado["validaciones"].append({
                    "paso": "Vigencia del Certificado",
                    "estado": "error",
                    "mensaje": "❌ Certificado VENCIDO"
                })
                resultado["errores"].append("Certificado vencido")
                
        except Exception as e:
            resultado["validaciones"].append({
                "paso": "Extracción de Información",
                "estado": "error",
                "mensaje": f"Error extrayendo información: {str(e)}"
            })
            resultado["errores"].append(f"Info: {str(e)}")
        
        # === 4. VERIFICAR CORRESPONDENCIA CERTIFICADO-LLAVE ===
        try:
            cert_modulus = subprocess.run([
                "openssl", "x509", "-noout", "-modulus", "-in", str(cert_pem_path)
            ], capture_output=True, text=True, check=True).stdout
            
            key_modulus = subprocess.run([
                "openssl", "rsa", "-noout", "-modulus", "-in", str(key_pem_path)
            ], capture_output=True, text=True, check=True).stdout
            
            if cert_modulus == key_modulus:
                resultado["validaciones"].append({
                    "paso": "Correspondencia Certificado-Llave",
                    "estado": "exitoso",
                    "mensaje": "✅ Certificado y llave privada coinciden"
                })
            else:
                resultado["validaciones"].append({
                    "paso": "Correspondencia Certificado-Llave",
                    "estado": "error",
                    "mensaje": "❌ Certificado y llave NO coinciden"
                })
                resultado["errores"].append("Certificado y llave no coinciden")
        except Exception as e:
            resultado["validaciones"].append({
                "paso": "Correspondencia Certificado-Llave",
                "estado": "error",
                "mensaje": f"Error verificando correspondencia: {str(e)}"
            })
            resultado["errores"].append(f"Correspondencia: {str(e)}")
        
        # === 5. VALIDAR CADENA DE CONFIANZA ===
        try:
            cmd_result = subprocess.run([
                "openssl", "verify",
                "-CAfile", str(ac_raiz_pem),
                "-untrusted", str(ac_sub_pem),
                str(cert_pem_path)
            ], capture_output=True, text=True, timeout=10)
            
            if "OK" in cmd_result.stdout:
                resultado["validaciones"].append({
                    "paso": "Cadena de Confianza",
                    "estado": "exitoso",
                    "mensaje": "✅ Cadena de certificación verificada"
                })
            else:
                resultado["validaciones"].append({
                    "paso": "Cadena de Confianza",
                    "estado": "error",
                    "mensaje": f"❌ Error en cadena: {cmd_result.stderr}"
                })
                resultado["errores"].append("Cadena de confianza inválida")
        except Exception as e:
            resultado["validaciones"].append({
                "paso": "Cadena de Confianza",
                "estado": "error",
                "mensaje": f"Error validando cadena: {str(e)}"
            })
            resultado["errores"].append(f"Cadena: {str(e)}")
        
        # Resumen final
        total_validaciones = len(resultado["validaciones"])
        exitosas = len([v for v in resultado["validaciones"] if v["estado"] == "exitoso"])
        errores_count = len([v for v in resultado["validaciones"] if v["estado"] == "error"])
        
        resultado["resumen"] = {
            "total_validaciones": total_validaciones,
            "exitosas": exitosas,
            "con_errores": errores_count,
            "con_advertencias": len(resultado["advertencias"]),
            "estado_general": "válido" if errores_count == 0 else "inválido"
        }
        
        return resultado
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Error en validación completa: {str(e)}\n{traceback.format_exc()}"
        )

@app.get("/api/config")
async def obtener_configuracion():
    """
    Retorna la configuración actual desde los archivos config_empresa.py y config_dian.py
    """
    import config_empresa
    import config_dian
    from importlib import reload
    
    # Recargar módulos para obtener valores actualizados
    reload(config_empresa)
    reload(config_dian)
    
    return {
        "empresa": {
            "nit": config_empresa.EMPRESA_NIT,
            "dv": config_empresa.EMPRESA_DV,
            "razon_social": config_empresa.EMPRESA_RAZON_SOCIAL,
            "nombre_comercial": config_empresa.EMPRESA_NOMBRE_COMERCIAL,
            "email": config_empresa.EMPRESA_EMAIL,
            "telefono": getattr(config_empresa, 'EMPRESA_TELEFONO', ''),
            "regimen": getattr(config_empresa, 'EMPRESA_REGIMEN', '48'),
            "responsabilidades": getattr(config_empresa, 'EMPRESA_RESPONSABILIDADES', ['O-13']),
            "direccion": {
                "address": config_empresa.EMPRESA_DIRECCION,
                "city": config_empresa.EMPRESA_CIUDAD_NOMBRE,
                "city_code": config_empresa.EMPRESA_CIUDAD_CODIGO,
                "department": config_empresa.EMPRESA_DEPARTAMENTO_NOMBRE,
                "department_code": config_empresa.EMPRESA_DEPARTAMENTO_CODIGO,
                "country": getattr(config_empresa, 'EMPRESA_PAIS', 'CO')
            }
        },
        "representante": {
            "nombres": config_empresa.EMPRESA_REPRESENTANTE_NOMBRE,
            "apellidos": config_empresa.EMPRESA_REPRESENTANTE_APELLIDOS,
            "cedula": config_empresa.EMPRESA_REPRESENTANTE_CEDULA
        },
        "certificado": {
            "ruta_certificado": config_dian.CERTIFICADO_PATH,
            "password": "********",
            "vigente": True
        },
        "software": {
            "software_id": config_dian.SOFTWARE_ID,
            "software_name": config_dian.SOFTWARE_NAME,
            "pin": config_dian.PIN,
            "clave_tecnica": config_dian.CLAVE_TECNICA,
            "test_set_id": config_dian.TEST_SET_ID
        },
        "resolucion": {
            "numero_resolucion": config_dian.RESOLUCION_NUMERO,
            "prefijo": config_dian.PREFIJO,
            "rango_desde": config_dian.RANGO_DESDE,
            "rango_hasta": config_dian.RANGO_HASTA,
            "fecha_desde": config_dian.RESOLUCION_FECHA_DESDE.strftime('%Y-%m-%d'),
            "fecha_hasta": config_dian.RESOLUCION_FECHA_HASTA.strftime('%Y-%m-%d')
        },
        "ambiente": {
            "ambiente": config_dian.AMBIENTE.upper(),
            "url_habilitacion": config_dian.DIAN_URL_HABILITACION,
            "url_produccion": config_dian.DIAN_URL_PRODUCCION
        }
    }

@app.post("/api/config")
async def guardar_configuracion(config: dict):
    """
    Guarda la configuración en los archivos config_empresa.py y config_dian.py
    """
    try:
        # Validar estructura de datos
        if "empresa" not in config:
            raise HTTPException(status_code=400, detail="Falta sección 'empresa' en configuración")
        if "direccion" not in config["empresa"]:
            raise HTTPException(status_code=400, detail="Falta 'direccion' en empresa")
        
        # Actualizar config_empresa.py
        config_empresa_path = Path(__file__).parent / "config_empresa.py"
        
        # Obtener valores con validación
        empresa = config["empresa"]
        direccion = empresa["direccion"]
        representante = config.get("representante", {})
        
        empresa_content = f"""
# Datos extraídos del certificado digital
# Última actualización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

EMPRESA_NIT = '{empresa.get("nit", "")}'
EMPRESA_DV = '{empresa.get("dv", "")}'
EMPRESA_RAZON_SOCIAL = '{empresa.get("razon_social", "")}'
EMPRESA_NOMBRE_COMERCIAL = '{empresa.get("nombre_comercial", "")}'
EMPRESA_EMAIL = '{empresa.get("email", "")}'
EMPRESA_TELEFONO = '{empresa.get("telefono", "")}'
EMPRESA_REGIMEN = '{empresa.get("regimen", "48")}'
EMPRESA_RESPONSABILIDADES = {empresa.get("responsabilidades", ["O-13"])}

# Dirección
EMPRESA_DIRECCION = '{direccion.get("address", "")}'
EMPRESA_CIUDAD_CODIGO = '{direccion.get("city_code", "")}'
EMPRESA_CIUDAD_NOMBRE = '{direccion.get("city", "")}'
EMPRESA_DEPARTAMENTO_CODIGO = '{direccion.get("department_code", "")}'
EMPRESA_DEPARTAMENTO_NOMBRE = '{direccion.get("department", "")}'
EMPRESA_PAIS = '{direccion.get("country", "CO")}'

# Datos del representante legal
EMPRESA_REPRESENTANTE_NOMBRE = '{representante.get("nombres", "")}'
EMPRESA_REPRESENTANTE_APELLIDOS = '{representante.get("apellidos", "")}'
EMPRESA_REPRESENTANTE_CEDULA = '{representante.get("cedula", "")}'
"""
        
        with open(config_empresa_path, 'w', encoding='utf-8') as f:
            f.write(empresa_content)
        
        # Actualizar config_dian.py
        config_dian_path = Path(__file__).parent / "config_dian.py"
        
        # Parsear fechas para evitar ceros a la izquierda
        fecha_desde = config["resolucion"]["fecha_desde"].split('-')
        fecha_hasta = config["resolucion"]["fecha_hasta"].split('-')
        fecha_desde_str = f"{int(fecha_desde[0])}, {int(fecha_desde[1])}, {int(fecha_desde[2])}"
        fecha_hasta_str = f"{int(fecha_hasta[0])}, {int(fecha_hasta[1])}, {int(fecha_hasta[2])}"
        
        dian_content = f'''#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Configuración DIAN - Datos del Software y Ambiente
Última actualización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
"""

from datetime import datetime

# ============================================================
# DATOS DEL SOFTWARE (Portal DIAN)
# ============================================================
SOFTWARE_ID = '{config["software"]["software_id"]}'
SOFTWARE_NAME = '{config["software"]["software_name"]}'
CLAVE_TECNICA = '{config["software"]["clave_tecnica"]}'
PIN = '{config["software"]["pin"]}'

# ============================================================
# DATOS DEL TEST SET
# ============================================================
TEST_SET_ID = '{config["software"]["test_set_id"]}'

# ============================================================
# DATOS DE LA RESOLUCIÓN
# ============================================================
RESOLUCION_NUMERO = '{config["resolucion"]["numero_resolucion"]}'
RESOLUCION_FECHA_DESDE = datetime({fecha_desde_str})
RESOLUCION_FECHA_HASTA = datetime({fecha_hasta_str})
PREFIJO = '{config["resolucion"]["prefijo"]}'
RANGO_DESDE = {config["resolucion"]["rango_desde"]}
RANGO_HASTA = {config["resolucion"]["rango_hasta"]}

# ============================================================
# URLS DE LA DIAN
# ============================================================
DIAN_URL_HABILITACION = '{config.get("ambiente", {}).get("url_habilitacion", "https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl")}'
DIAN_URL_PRODUCCION = '{config.get("ambiente", {}).get("url_produccion", "https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?wsdl")}'

# ============================================================
# CERTIFICADO DIGITAL
# ============================================================
'''
        
        # Manejar certificado: si viene en config usarlo, si no mantener el existente
        if "certificado" in config and config["certificado"].get("ruta_certificado"):
            cert_path = config["certificado"]["ruta_certificado"]
            cert_password = config["certificado"]["password"] if config["certificado"]["password"] != "********" else "pass123"
            dian_content += f'''CERTIFICADO_PATH = '{cert_path}'
CERTIFICADO_PASSWORD = '{cert_password}'

'''
        else:
            # Mantener certificado existente si no se proporciona
            try:
                import config_dian
                from importlib import reload
                reload(config_dian)
                cert_path = config_dian.CERTIFICADO_PATH
                cert_password = config_dian.CERTIFICADO_PASSWORD
                dian_content += f'''CERTIFICADO_PATH = '{cert_path}'
CERTIFICADO_PASSWORD = '{cert_password}'

'''
            except:
                # Por defecto usar la ruta estándar
                dian_content += '''CERTIFICADO_PATH = '/home/hide/Documentos/PROYECTOS/Factura Electrónica/facho-master/certificados/certificado_digital.pfx'
CERTIFICADO_PASSWORD = 'pass123'

'''

        dian_content += f'''# ============================================================
# AMBIENTE
# ============================================================
AMBIENTE = '{config["ambiente"]["ambiente"].upper()}'

def get_url():
    """Retorna la URL según el ambiente configurado"""
    if AMBIENTE == 'PRODUCCION':
        return DIAN_URL_PRODUCCION
    else:
        return DIAN_URL_HABILITACION
'''
        
        with open(config_dian_path, 'w', encoding='utf-8') as f:
            f.write(dian_content)
        
        return {
            "success": True,
            "message": "Configuración guardada correctamente"
        }
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Error guardando configuración: {str(e)}\n{traceback.format_exc()}"
        )

@app.get("/api/config/estadisticas")
async def obtener_estadisticas():
    """
    Retorna estadísticas del sistema calculadas desde los archivos de configuración
    """
    import config_dian
    from importlib import reload
    
    reload(config_dian)
    
    # Leer último consecutivo usado desde archivo por NIT
    # NOTA: Este endpoint debería recibir el NIT como parámetro para soportar multi-empresa
    # Por ahora usa el config_dian global como fallback
    empresa_nit = getattr(config_dian, 'EMPRESA_NIT', '900565733')  # NIT por defecto
    consecutivo_file = Path(__file__).parent / "certificados" / empresa_nit / ".ultimo_consecutivo_factura.txt"
    if consecutivo_file.exists():
        try:
            with open(consecutivo_file, 'r') as f:
                ultimo_usado = int(f.read().strip())
        except (ValueError, FileNotFoundError):
            ultimo_usado = config_dian.RANGO_DESDE
    else:
        ultimo_usado = config_dian.RANGO_DESDE
    
    # Calcular facturas usadas y disponibles
    proximo = ultimo_usado + 1
    facturas_usadas = ultimo_usado - config_dian.RANGO_DESDE + 1
    facturas_disponibles = config_dian.RANGO_HASTA - ultimo_usado
    porcentaje_uso = (facturas_usadas / (config_dian.RANGO_HASTA - config_dian.RANGO_DESDE + 1)) * 100
    
    # Calcular días de vigencia restantes
    dias_vigencia = (config_dian.RESOLUCION_FECHA_HASTA - datetime.now()).days
    
    return {
        "consecutivos": {
            "proximo": proximo,
            "ultimo_usado": ultimo_usado,
            "facturas_usadas": facturas_usadas,
            "facturas_disponibles": facturas_disponibles,
            "porcentaje_uso": round(porcentaje_uso, 2)
        },
        "resolucion": {
            "dias_vigencia_restantes": dias_vigencia,
            "vencimiento": config_dian.RESOLUCION_FECHA_HASTA.strftime('%Y-%m-%d')
        },
        "ambiente": config_dian.AMBIENTE
    }

@app.post("/api/config/test-conexion")
async def test_conexion():
    """
    Prueba la conexión con los servicios web de la DIAN
    """
    try:
        import importlib
        import requests
        from zeep import Client
        from zeep.transports import Transport
        from requests import Session
        
        # Recargar configuración
        config_dian = importlib.import_module('config_dian')
        importlib.reload(config_dian)
        
        # Obtener URL según ambiente configurado
        url = config_dian.get_url()
        
        # Intentar conectar con timeout de 10 segundos
        session = Session()
        session.timeout = 10
        transport = Transport(session=session)
        
        # Crear cliente SOAP
        client = Client(url, transport=transport)
        
        # Verificar que el servicio responde
        # No necesitamos hacer una operación real, solo verificar que el WSDL se cargue
        service_name = client.service._operations.keys() if hasattr(client.service, '_operations') else []
        
        return {
            "exito": True,
            "mensaje": f"Conexión exitosa con DIAN ({config_dian.AMBIENTE})",
            "url": url,
            "ambiente": config_dian.AMBIENTE,
            "servicios_disponibles": len(list(service_name)) if service_name else 0
        }
        
    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=408,
            detail="Timeout al conectar con DIAN. Verifica tu conexión a internet."
        )
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="No se pudo conectar con los servicios de la DIAN. Verifica la URL y tu conexión."
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error al probar conexión: {str(e)}"
        )

@app.post("/api/pruebas/enviar")
async def enviar_documento_prueba(datos: dict):
    """
    Envía un documento a la DIAN usando los datos REALES 
    de la empresa configurados en el sistema (certificado, resolución, etc.)
    
    Parámetros:
    - tipo_documento: 'factura' o 'soporte'
    - empresa_nit: NIT de la empresa (OBLIGATORIO)
    - ambiente: 'habilitacion' o 'produccion' (default: 'habilitacion')
    """
    try:
        import subprocess
        import importlib
        import re
        
        # Obtener NIT de la empresa (OBLIGATORIO - sin empresa por defecto)
        empresa_nit = datos.get('empresa_nit')
        if not empresa_nit:
            raise HTTPException(
                status_code=400,
                detail="El NIT de la empresa es obligatorio. Debe proporcionarse 'empresa_nit' en la solicitud."
            )
        
        # Obtener ambiente (habilitacion o produccion)
        ambiente = datos.get('ambiente', 'habilitacion').lower()
        if ambiente not in ['habilitacion', 'produccion']:
            ambiente = 'habilitacion'
        
        print(f"🏢 Enviando documento para empresa NIT: {empresa_nit}")
        print(f"🌍 Ambiente: {ambiente.upper()}")
        
        # Verificar que existe la carpeta de configuración de la empresa
        empresa_config_dir = Path(__file__).parent / "certificados" / empresa_nit
        if not empresa_config_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"No existe configuración para la empresa NIT {empresa_nit}. Genere los archivos de configuración primero."
            )
        
        # Cargar configuración de la empresa específica usando spec_from_file_location
        # Esto garantiza que se carga el archivo EXACTO de la empresa, no el global
        import sys
        import importlib.util
        
        # Rutas exactas a los archivos de configuración de la empresa
        # IMPORTANTE: Usar archivo según el ambiente (habilitación o producción)
        config_dian_filename = "config_dian_produccion.py" if ambiente == "produccion" else "config_dian.py"
        config_dian_path = empresa_config_dir / config_dian_filename
        config_empresa_path = empresa_config_dir / "config_empresa.py"
        
        print(f"🔍 Ambiente: {ambiente.upper()} -> Buscando: {config_dian_filename}")
        
        if not config_dian_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"No existe {config_dian_filename} para la empresa NIT {empresa_nit}. Regenere la configuración."
            )
        
        if not config_empresa_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"No existe config_empresa.py para la empresa NIT {empresa_nit}. Regenere la configuración."
            )
        
        # Limpiar cache de módulos anteriores
        for mod_name in ['config_empresa_loaded', 'config_dian_loaded']:
            if mod_name in sys.modules:
                del sys.modules[mod_name]
        
        # Cargar config_dian desde el archivo específico de la empresa
        spec_dian = importlib.util.spec_from_file_location("config_dian_loaded", str(config_dian_path))
        config_dian = importlib.util.module_from_spec(spec_dian)
        sys.modules["config_dian_loaded"] = config_dian
        spec_dian.loader.exec_module(config_dian)
        
        # Cargar config_empresa desde el archivo específico de la empresa
        spec_empresa = importlib.util.spec_from_file_location("config_empresa_loaded", str(config_empresa_path))
        config_empresa = importlib.util.module_from_spec(spec_empresa)
        sys.modules["config_empresa_loaded"] = config_empresa
        spec_empresa.loader.exec_module(config_empresa)
        
        # Debug: verificar que se cargó el archivo correcto
        print(f"📁 config_dian cargado desde: {config_dian_path}")
        print(f"📁 config_empresa cargado desde: {config_empresa_path}")
        
        # Verificar los valores cargados
        rango_ds_desde = getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', None)
        rango_ds_hasta = getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', None)
        print(f"🔍 VERIFICACIÓN: RESOLUCION_DS_NUMERO_DESDE = {rango_ds_desde}")
        print(f"🔍 VERIFICACIÓN: RESOLUCION_DS_NUMERO_HASTA = {rango_ds_hasta}")
        
        # Obtener tipo de documento
        tipo_doc = datos.get('tipo_documento', 'factura')
        
        # IMPORTANTE: Si el frontend pasa un consecutivo explícito, usarlo directamente
        # Esto garantiza sincronización con el backend Node.js
        consecutivo_solicitado = datos.get('consecutivo')  # Ej: "DCSW6"
        numero_solicitado = datos.get('numero')  # Ej: 6
        prefijo_solicitado = datos.get('prefijo')  # Ej: "DCSW"
        
        if consecutivo_solicitado:
            print(f"📋 Consecutivo explícito recibido del frontend: {consecutivo_solicitado}")
        if numero_solicitado:
            print(f"📋 Número explícito recibido del frontend: {numero_solicitado}")
        if prefijo_solicitado:
            print(f"📋 Prefijo explícito recibido del frontend: {prefijo_solicitado}")
        
        # Detectar último número usado - ARCHIVOS POR EMPRESA Y TIPO Y AMBIENTE
        workspace = Path(__file__).parent
        empresa_dir = workspace / "certificados" / empresa_nit
        
        # Leer configuración de resolución desde config_dian (NO config_empresa)
        # IMPORTANTE: Usar archivos de consecutivos según ambiente (habilitación o producción)
        sufijo_ambiente = "_prod" if ambiente == "produccion" else ""
        
        if tipo_doc == 'soporte':
            # Archivo de control por empresa y ambiente
            consecutivo_file = empresa_dir / f'.ultimo_consecutivo_soporte{sufijo_ambiente}.txt'
            prefijo_busqueda = prefijo_solicitado or getattr(config_dian, 'RESOLUCION_DS_PREFIJO', 'SEDS')
            rango_inicio = getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', 984000000)
            rango_fin = getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', 985000000)
            consecutivo_inicial = rango_inicio  # Usar el inicio del rango como inicial
            print(f"🔍 DEBUG DS - RESOLUCION_DS_NUMERO_DESDE: {rango_inicio}")
            print(f"🔍 DEBUG DS - RESOLUCION_DS_NUMERO_HASTA: {rango_fin}")
        else:
            # Archivo de control por empresa y ambiente
            consecutivo_file = empresa_dir / f'.ultimo_consecutivo_factura{sufijo_ambiente}.txt'
            prefijo_busqueda = getattr(config_dian, 'PREFIJO', 'SETP')
            rango_inicio = getattr(config_dian, 'RANGO_DESDE', 990000000)
            rango_fin = getattr(config_dian, 'RANGO_HASTA', 995000000)
            consecutivo_inicial = rango_inicio  # Usar el inicio del rango como inicial
        
        print(f"📋 Rango de consecutivos configurado: {rango_inicio} - {rango_fin}")
        print(f"📋 Archivo de consecutivo: {consecutivo_file}")
        
        max_num = None
        
        # Primero, verificar archivo de control específico de la empresa
        if consecutivo_file.exists():
            try:
                with open(consecutivo_file, 'r') as f:
                    saved_num = int(f.read().strip())
                    max_num = saved_num
                    print(f"✅ Consecutivo {tipo_doc} leído del archivo de empresa {empresa_nit}: {max_num}")
                    
                    # IMPORTANTE: Si el consecutivo guardado está FUERA del rango actual,
                    # ignorarlo y empezar desde el inicio del nuevo rango
                    if saved_num < rango_inicio or saved_num > rango_fin:
                        print(f"⚠️  Consecutivo guardado ({saved_num}) está FUERA del rango actual ({rango_inicio}-{rango_fin})")
                        print(f"⚠️  Ignorando consecutivo guardado, iniciando desde: {rango_inicio}")
                        max_num = None  # Forzar inicio desde rango_inicio
            except Exception as e:
                print(f"⚠️ Error leyendo consecutivo: {e}")
                pass
        
        # Si no hay archivo de control, buscar en archivos de la carpeta de la empresa
        if max_num is None:
            ignore_folders = ['Anexos', 'Caja-de-herramientas', 'DIAN']
            
            # Buscar solo en la carpeta de la empresa específica, no en todo el workspace
            search_dir = empresa_dir if empresa_dir.exists() else workspace
            
            for filename in os.listdir(search_dir):
                filepath = os.path.join(search_dir, filename)
                
                if not os.path.isfile(filepath):
                    continue
                    
                skip = False
                for ignore_folder in ignore_folders:
                    if ignore_folder.lower() in filename.lower():
                        skip = True
                        break
                if skip:
                    continue
                
                if not any(filename.endswith(ext) for ext in ['.txt', '.md', '.log', '.xml']):
                    continue
                
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        # Buscar por prefijo específico
                        pattern = f'{prefijo_busqueda}(\\d+)'
                        matches = re.findall(pattern, content)
                        for match in matches:
                            num = int(match)
                            if rango_inicio <= num <= rango_fin:
                                if max_num is None or num > max_num:
                                    max_num = num
                                    print(f"[DEBUG] Encontrado consecutivo {prefijo_busqueda}{num} en {filename}")
                except Exception as e:
                    print(f"[DEBUG] Error leyendo {filename}: {e}")
                    continue
        
        # Siguiente consecutivo
        # PRIORIDAD: Si el frontend envía un número explícito, usarlo
        if numero_solicitado is not None:
            next_num = int(numero_solicitado)
            print(f"✅ Usando consecutivo explícito del frontend: {next_num}")
        elif max_num is None:
            next_num = consecutivo_inicial
            print(f"[DEBUG] No se encontró consecutivo {tipo_doc}, empezando desde {next_num}")
        else:
            next_num = max_num + 1
            print(f"[DEBUG] Último consecutivo {tipo_doc}: {max_num}, siguiente: {next_num}")
        
        # Validar que el consecutivo esté dentro del rango autorizado
        if next_num < rango_inicio:
            next_num = rango_inicio
            print(f"⚠️  Consecutivo ajustado al inicio del rango: {next_num}")
        
        if next_num > rango_fin:
            raise HTTPException(
                status_code=400,
                detail=f"❌ Se ha excedido el rango de consecutivos autorizado. Último disponible: {rango_fin}, solicitado: {next_num}. Por favor, solicite una nueva resolución a la DIAN."
            )
        
        # Alerta si se está acercando al límite (90% del rango usado)
        consecutivos_usados = next_num - rango_inicio
        consecutivos_totales = rango_fin - rango_inicio + 1
        porcentaje_usado = (consecutivos_usados / consecutivos_totales) * 100
        
        if porcentaje_usado >= 90:
            consecutivos_restantes = rango_fin - next_num + 1
            print(f"⚠️  ALERTA: Se ha usado el {porcentaje_usado:.1f}% de los consecutivos. Quedan {consecutivos_restantes} consecutivos disponibles.")
            print(f"⚠️  Considere solicitar una nueva resolución a la DIAN pronto.")
        
        # Preparar archivo JSON con datos dinámicos si se proporcionaron
        json_temp_path = None
        tipo_ds = None
        
        if datos.get('cliente'):
            tipo_ds = 'BONO_CLIENTE'
            json_temp_path = f'/tmp/datos_ds_{next_num}.json'
            import json as json_module
            # Incluir datos del bono si existen
            datos_json = {'cliente': datos['cliente']}
            if datos.get('bono'):
                datos_json['bono'] = datos['bono']
            with open(json_temp_path, 'w', encoding='utf-8') as f:
                json_module.dump(datos_json, f, ensure_ascii=False)
            print(f"📝 Datos de cliente guardados en: {json_temp_path}")
            # Log detallado de los datos del cliente para debugging
            cliente = datos['cliente']
            print(f"📝 [DEBUG] Cliente nombres: {cliente.get('nombres', 'N/A')}")
            print(f"📝 [DEBUG] Cliente apellidos: {cliente.get('apellidos', 'N/A')}")
            print(f"📝 [DEBUG] Cliente numero_documento: {cliente.get('numero_documento', 'N/A')}")
            print(f"📝 [DEBUG] Cliente direccion: {cliente.get('direccion', 'N/A')}")
            print(f"📝 [DEBUG] Cliente ciudad_codigo: {cliente.get('ciudad_codigo', 'N/A')}")
            if datos.get('bono'):
                print(f"📝 Datos del bono incluidos: valor=${datos['bono'].get('valor_total', 'N/A')}")
        elif datos.get('proveedor_sno'):
            tipo_ds = 'COMPRA_SNO'
            json_temp_path = f'/tmp/datos_ds_{next_num}.json'
            import json as json_module
            # Incluir datos del bono si existen
            datos_json = {'proveedor_sno': datos['proveedor_sno']}
            if datos.get('bono'):
                datos_json['bono'] = datos['bono']
            with open(json_temp_path, 'w', encoding='utf-8') as f:
                json_module.dump(datos_json, f, ensure_ascii=False)
            print(f"📝 Datos de proveedor guardados en: {json_temp_path}")
        
        # Ejecutar script de envío según tipo de documento Y AMBIENTE
        # IMPORTANTE: Pasar el NIT como primer parámetro
        if tipo_doc == 'soporte':
            # Seleccionar script según ambiente
            if ambiente == 'produccion':
                script_name = "enviar_documento_soporte_produccion.py"
            else:
                script_name = "enviar_documento_soporte_habilitacion.py"
            # Documento soporte: NIT + consecutivo [+ TIPO_DS + JSON_PATH]
            cmd = ["python3", str(workspace / script_name), empresa_nit, str(next_num)]
            if tipo_ds and json_temp_path:
                cmd.extend([tipo_ds, json_temp_path])
        else:
            # Seleccionar script según ambiente
            if ambiente == 'produccion':
                script_name = "enviar_factura_produccion.py"
            else:
                script_name = "enviar_factura_habilitacion.py"
            # Factura: NIT + consecutivo como parámetros
            cmd = ["python3", str(workspace / script_name), empresa_nit, str(next_num)]
        
        print(f"📋 Ejecutando script: {script_name}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,  # 3 minutos
            cwd=workspace
        )
        
        output = result.stdout + result.stderr
        
        # Analizar resultado con mayor detalle
        # Si IsValid: True y StatusCode: 00 = AUTORIZADO (aunque tenga notificaciones)
        is_valid = "IsValid: True" in output
        status_code_00 = "StatusCode: 00" in output
        tiene_rechazos = "Rechazo:" in output
        
        # Detectar si el documento ya fue procesado anteriormente (duplicado)
        es_duplicado = (
            "procesado anteriormente" in output.lower() or
            "regla: 90" in output.lower() or
            "regla 90" in output.lower() or
            "documento procesado" in output.lower() or
            "[90]" in output or
            ("90" in output and "procesado" in output.lower())
        )
        
        # Debug
        print(f"[DEBUG] is_valid: {is_valid}, status_code_00: {status_code_00}, tiene_rechazos: {tiene_rechazos}, es_duplicado: {es_duplicado}")
        print(f"[DEBUG] Output preview: {output[:500]}")
        
        # Determinar estado correcto
        if is_valid and status_code_00:
            estado = "AUTORIZADO"
        elif es_duplicado:
            estado = "PROCESADO"  # Ya fue procesado anteriormente
        elif tiene_rechazos:
            estado = "RECHAZADO"
        else:
            estado = "ERROR"
        
        # Un documento "PROCESADO" (duplicado) también se considera exitoso
        # porque el documento YA existe en la DIAN
        exito = estado == "AUTORIZADO" or estado == "PROCESADO"
        
        # Extraer CUFE/CUDS (buscar el del documento, no el del ApplicationResponse)
        cufe = None
        cuds = None
        
        # Para documento soporte, buscar CUDS
        if tipo_doc == 'soporte':
            cuds_match = re.search(r'XmlDocumentKey: ([a-f0-9]{96})', output)
            if cuds_match:
                cuds = cuds_match.group(1)
            else:
                # Buscar CUDS alternativo
                cuds_match = re.search(r'CUDS[:-]\s*([a-f0-9]{96})', output)
                if cuds_match:
                    cuds = cuds_match.group(1)
        else:
            # Para factura, buscar CUFE
            cufe_match = re.search(r'XmlDocumentKey: ([a-f0-9]{96})', output)
            if cufe_match:
                cufe = cufe_match.group(1)
            else:
                # Buscar CUFE alternativo
                cufe_match = re.search(r'CUFE[:-]\s*([a-f0-9]{96})', output)
                if cufe_match:
                    cufe = cufe_match.group(1)
        
        # Extraer errores y advertencias con MUCHO más detalle
        errores = []
        advertencias = []
        
        output_lines = output.split('\n')
        
        # Buscar en la sección "DETALLE DE ERRORES:" que genera el script
        en_seccion_errores = False
        for i, line in enumerate(output_lines):
            line_clean = line.strip()
            
            # Detectar inicio de sección de errores
            if 'DETALLE DE ERRORES:' in line_clean or 'TOTAL DE ERRORES:' in line_clean:
                en_seccion_errores = True
                continue
            
            # Detectar fin de sección de errores
            if en_seccion_errores and ('Archivos guardados:' in line_clean or 'DATOS USADOS' in line_clean or '═' in line_clean):
                en_seccion_errores = False
                continue
            
            # Extraer errores de la sección (líneas que empiezan con número)
            if en_seccion_errores and line_clean:
                # Buscar líneas como "1. Regla: FAJ43b, Notificación: ..."
                if re.match(r'^\d+\.', line_clean):
                    # Eliminar el número al inicio
                    error_text = re.sub(r'^\d+\.\s*', '', line_clean)
                    if error_text:
                        errores.append(error_text)
                elif line_clean and not line_clean.startswith('-'):
                    # Línea de continuación
                    if errores:
                        errores[-1] += ' ' + line_clean
        
        # Si no encontró nada en la sección, buscar directamente patrones
        if len(errores) == 0:
            for line in output_lines:
                line_clean = line.strip()
                
                # Buscar líneas que contengan "Regla:" o "Rechazo:"
                if 'Regla:' in line_clean and ('Rechazo:' in line_clean or 'Notificación:' in line_clean):
                    errores.append(line_clean)
                elif 'ErrorMessage:' in line_clean:
                    # Buscar errores en el ErrorMessage
                    idx = output_lines.index(line)
                    for j in range(idx + 1, min(idx + 10, len(output_lines))):
                        if output_lines[j].strip() and not output_lines[j].strip().startswith('}'):
                            error_line = output_lines[j].strip().strip("'").strip(',').strip()
                            if error_line and error_line not in ['string', '[', ']', '{', '}']:
                                errores.append(error_line)
        
        # Extraer advertencias (Notificaciones que NO son rechazos)
        for line in output_lines:
            line_clean = line.strip()
            if 'Notificación:' in line_clean and 'Rechazo:' not in line_clean:
                if 'Regla:' in line_clean:
                    advertencias.append(line_clean)
        
        # Limpiar y eliminar duplicados
        errores_unicos = []
        for e in errores:
            e = e.strip()
            if e and e not in errores_unicos and e not in ['string', '[', ']', '{', '}', ')', '(']:
                errores_unicos.append(e)
        errores = errores_unicos[:10]
        
        advertencias_unicas = []
        for a in advertencias:
            a = a.strip()
            if a and a not in advertencias_unicas:
                advertencias_unicas.append(a)
        advertencias = advertencias_unicas[:5]
        
        print(f"[DEBUG] Estado: {estado}")
        print(f"[DEBUG] Errores encontrados: {len(errores)}")
        print(f"[DEBUG] Advertencias encontradas: {len(advertencias)}")
        
        # Determinar prefijo y consecutivo exactos del documento enviado
        prefijo_resultado = (prefijo_busqueda or '').strip()
        prefijo_output_match = re.search(r'Prefijo Usado:\s*([A-Za-z0-9\-]+)', output)
        if prefijo_output_match:
            prefijo_detectado = prefijo_output_match.group(1).strip()
            if prefijo_detectado:
                prefijo_resultado = prefijo_detectado
        if not prefijo_resultado:
            prefijo_resultado = 'SEDS' if tipo_doc == 'soporte' else 'SETP'

        def leer_consecutivo_archivo() -> int | None:
            if not consecutivo_file.exists():
                return None
            try:
                return int(consecutivo_file.read_text().strip())
            except Exception:
                return None

        def extraer_identificadores(prefijo: str) -> list[str]:
            if not prefijo:
                return []
            patron = re.compile(rf'({re.escape(prefijo)}\d+)')
            return patron.findall(output)

        candidatos = set(extraer_identificadores(prefijo_resultado))

        # Añadir fallback explícito en caso de que el prefijo detectado no aparezca
        prefijo_fallback = 'SEDS' if tipo_doc == 'soporte' else 'SETP'
        if prefijo_fallback != prefijo_resultado:
            candidatos.update(extraer_identificadores(prefijo_fallback))

        def valor_numerico(ident: str) -> int:
            match = re.search(r'(\d+)$', ident)
            return int(match.group(1)) if match else -1

        numero_archivo = leer_consecutivo_archivo()

        if candidatos:
            doc_numero_detectado = max(candidatos, key=valor_numerico)
            numero_detectado = valor_numerico(doc_numero_detectado)
        else:
            doc_numero_detectado = None
            numero_detectado = -1

        # IMPORTANTE: Usar siempre el consecutivo que se ENVIÓ al script (next_num),
        # no el máximo de los valores encontrados. Esto evita usar consecutivos 
        # de otros documentos que puedan estar en el archivo de control.
        numero_final = next_num
        
        # Solo para logging, mostrar los valores detectados
        print(f"[DEBUG] Consecutivo enviado al script: {next_num}")
        print(f"[DEBUG] Consecutivo en archivo: {numero_archivo}")
        print(f"[DEBUG] Consecutivo detectado en output: {numero_detectado}")
        print(f"[DEBUG] Usando consecutivo: {numero_final}")

        doc_numero = f"{prefijo_resultado}{numero_final}"

        # Construir mensaje detallado según tipo de documento
        if tipo_doc == 'soporte':
            if exito:
                mensaje = f"✅ Documento soporte {doc_numero} autorizado por la DIAN"
            elif estado == "RECHAZADO":
                mensaje = f"❌ Documento soporte {doc_numero} rechazado por la DIAN ({len(errores)} errores detectados)"
            elif estado == "PROCESADO":
                mensaje = f"⚠️ Documento soporte {doc_numero} ya fue procesado anteriormente"
            elif estado == "PENDIENTE":
                mensaje = f"⏳ Documento soporte {doc_numero} enviado y en proceso de validación"
            else:
                mensaje = f"⚠️ Error al procesar documento soporte {doc_numero}"
        else:
            if exito:
                mensaje = f"✅ Documento {doc_numero} autorizado por la DIAN"
            elif estado == "RECHAZADO":
                mensaje = f"❌ Documento {doc_numero} rechazado por la DIAN ({len(errores)} errores detectados)"
            elif estado == "PROCESADO":
                mensaje = f"⚠️ Documento {doc_numero} ya fue procesado anteriormente"
            elif estado == "PENDIENTE":
                mensaje = f"⏳ Documento {doc_numero} enviado y en proceso de validación"
            else:
                mensaje = f"⚠️ Error al procesar documento {doc_numero}"
        
        # 💾 NOTA: El consecutivo YA fue guardado por el script Python
        # No es necesario guardarlo de nuevo aquí para evitar condiciones de carrera
        # El script enviar_documento_soporte_habilitacion.py o enviar_factura_habilitacion.py
        # ya se encargan de guardar el consecutivo correctamente en TODOS los casos:
        # - Documento autorizado
        # - Documento rechazado
        # - Documento ya procesado
        # - Error de comunicación
        
        # Solo reportamos el estado para fines de logging
        if estado == "PROCESADO":
            print(f"ℹ️  Consecutivo {numero_final} ya fue procesado anteriormente (guardado por script)")
        elif estado == "RECHAZADO":
            print(f"ℹ️  Consecutivo {numero_final} rechazado por DIAN (guardado por script)")
        elif estado == "AUTORIZADO":
            print(f"ℹ️  Consecutivo {numero_final} autorizado por DIAN (guardado por script)")
        else:
            print(f"ℹ️  Consecutivo {numero_final} procesado para empresa {empresa_nit} (guardado por script)")
        
        # Buscar archivos XML y ZIP generados
        xml_url = None
        pdf_url = None
        
        if tipo_doc == 'soporte':
            # Para producción: ds_prod_DCSW5_firmado.xml
            # Para habilitación: ds_SEDS984000070_firmada.xml
            if ambiente == 'produccion':
                xml_filename = f"ds_prod_{doc_numero}_firmado.xml"
                zip_filename = f"ds_prod_{doc_numero}.zip"
            else:
                xml_filename = f"ds_{doc_numero}_firmada.xml"
                zip_filename = f"ds_{doc_numero}.zip"
            
            xml_path = Path("/tmp") / xml_filename
            zip_path = Path("/tmp") / zip_filename
            
            # Copiar archivos a directorio de certificados para acceso permanente
            dest_dir = Path(__file__).parent / "certificados" / empresa_nit / "documentos"
            dest_dir.mkdir(parents=True, exist_ok=True)
            
            if xml_path.exists():
                import shutil
                dest_xml = dest_dir / xml_filename
                shutil.copy2(xml_path, dest_xml)
                xml_url = f"/api/dian/documentos/{empresa_nit}/{xml_filename}"
                print(f"📄 XML copiado a: {dest_xml}")
            
            if zip_path.exists():
                import shutil
                dest_zip = dest_dir / zip_filename
                shutil.copy2(zip_path, dest_zip)
                # El ZIP puede servir como respaldo
                print(f"📦 ZIP copiado a: {dest_zip}")
        
        # 🆕 Buscar archivo JSON de validación DIAN para obtener errores completos
        validacion_json_path = None
        errores_dian = []
        try:
            # Buscar archivo de validación
            validacion_dir = Path(__file__).parent / "certificados" / empresa_nit / "documentos"
            validacion_file = validacion_dir / f"ds_prod_validacion_{doc_numero}.json"
            if validacion_file.exists():
                import json as json_module
                with open(validacion_file, 'r', encoding='utf-8') as f:
                    validacion_data = json_module.load(f)
                    if validacion_data.get('validacion_dian', {}).get('ErrorMessage'):
                        errores_dian = validacion_data['validacion_dian']['ErrorMessage']
                        print(f"📋 Errores cargados de validación JSON: {len(errores_dian)}")
                validacion_json_path = str(validacion_file)
        except Exception as e:
            print(f"⚠️  Error leyendo validación JSON: {e}")
        
        # Si encontramos errores en el JSON, usar esos en lugar de los parseados
        if errores_dian:
            errores = errores_dian
        
        return {
            "exito": exito or estado == "PENDIENTE",
            "estado": estado,
            "estado_dian": estado,
            "numero_documento": doc_numero,
            "cufe": cufe,
            "cuds": cuds,  # Agregar CUDS para documentos soporte
            "ambiente": config_dian.AMBIENTE,
            "mensaje": mensaje,
            "errores": errores,
            "advertencias": advertencias,
            "xml_url": xml_url,
            "pdf_url": pdf_url,  # TODO: Generar PDF a partir del XML
            "validacion_json": validacion_json_path,
            "detalles_completos": {
                "return_code": result.returncode,
                "tiene_cufe": cufe is not None,
                "tiene_cuds": cuds is not None,
                "total_errores": len(errores),
                "total_advertencias": len(advertencias)
            },
            "output_completo": output,  # TODO el output para ver logs de configuración
            "logs_configuracion": output[:3000] if len(output) > 3000 else output  # Primeros 3000 caracteres con la config
        }
        
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=408,
            detail="Timeout al enviar documento. El proceso tardó demasiado."
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error al enviar documento de prueba: {str(e)}"
        )

# ============================================================================
# 💾 SISTEMA DE BACKUP Y RESTORE
# ============================================================================

@app.post("/api/config/backup/create")
async def crear_backup():
    """
    Crea un backup completo de la configuración actual.
    
    Incluye:
    - Archivos de configuración (config_dian.py, config_empresa.py)
    - Archivos de certificados (.pfx, .key, .crt)
    - Consecutivos actuales
    - Timestamp del backup
    
    Returns:
        dict: Información del backup creado
    """
    try:
        import shutil
        from datetime import datetime
        import json
        
        # Crear directorio de backups si no existe
        backup_dir = Path(__file__).parent / "backups"
        backup_dir.mkdir(exist_ok=True)
        
        # Nombre del backup con timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"backup_config_{timestamp}"
        backup_path = backup_dir / backup_name
        backup_path.mkdir(exist_ok=True)
        
        # Lista de archivos a respaldar
        archivos_backup = [
            "config_dian.py",
            "config_empresa.py",
            "api_config.py"
        ]
        
        # Copiar archivos de configuración
        for archivo in archivos_backup:
            source = Path(__file__).parent / archivo
            if source.exists():
                shutil.copy2(source, backup_path / archivo)
        
        # Copiar certificados si existen
        cert_dir = Path(__file__).parent / "certificados"
        if cert_dir.exists():
            backup_cert_dir = backup_path / "certificados"
            backup_cert_dir.mkdir(exist_ok=True)
            
            for cert_file in cert_dir.glob("*"):
                if cert_file.is_file():
                    shutil.copy2(cert_file, backup_cert_dir / cert_file.name)
        
        # Crear archivo de metadatos
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "version": "1.0",
            "descripcion": "Backup automático de configuración funcional",
            "archivos": [f.name for f in backup_path.rglob("*") if f.is_file()]
        }
        
        with open(backup_path / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)
        
        return {
            "success": True,
            "backup_file": backup_name,
            "backup_path": str(backup_path),
            "timestamp": metadata["timestamp"],
            "archivos_respaldados": len(metadata["archivos"])
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al crear backup: {str(e)}")


@app.post("/api/config/backup/restore")
async def restaurar_backup(data: dict):
    """
    Restaura un backup previo de la configuración.
    
    Requiere la contraseña del certificado PFX para validar que el usuario
    tiene autorización para restaurar.
    
    Args:
        data (dict): Debe contener 'password' del certificado
    
    Returns:
        dict: Información de la restauración
    """
    try:
        import shutil
        from datetime import datetime
        import json
        
        password = data.get("password")
        if not password:
            raise HTTPException(status_code=400, detail="Se requiere la contraseña del certificado")
        
        # Buscar el backup más reciente
        backup_dir = Path(__file__).parent / "backups"
        if not backup_dir.exists():
            raise HTTPException(status_code=404, detail="No hay backups disponibles")
        
        # Obtener todos los backups ordenados por fecha (más reciente primero)
        backups = sorted(backup_dir.glob("backup_config_*"), key=lambda x: x.name, reverse=True)
        
        if not backups:
            raise HTTPException(status_code=404, detail="No hay backups disponibles")
        
        latest_backup = backups[0]
        
        # Validar contraseña del certificado antes de restaurar
        cert_backup = latest_backup / "certificados"
        if cert_backup.exists():
            pfx_file = next(cert_backup.glob("*.pfx"), None)
            if pfx_file:
                try:
                    with open(pfx_file, 'rb') as f:
                        pfx_data = f.read()
                    
                    # Intentar cargar el PFX con la contraseña proporcionada
                    private_key, certificate, ca_certs = pkcs12.load_key_and_certificates(
                        pfx_data,
                        password.encode('utf-8'),
                        default_backend()
                    )
                    
                    if not private_key or not certificate:
                        raise HTTPException(status_code=401, detail="Contraseña incorrecta del certificado")
                        
                except Exception as e:
                    raise HTTPException(status_code=401, detail="Contraseña incorrecta del certificado")
        
        # Leer metadata del backup
        metadata_file = latest_backup / "metadata.json"
        metadata = {}
        if metadata_file.exists():
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
        
        # Crear backup de la configuración actual antes de restaurar
        current_backup_name = f"pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        current_backup_path = backup_dir / current_backup_name
        current_backup_path.mkdir(exist_ok=True)
        
        # Respaldar configuración actual
        for archivo in ["config_dian.py", "config_empresa.py", "api_config.py"]:
            source = Path(__file__).parent / archivo
            if source.exists():
                shutil.copy2(source, current_backup_path / archivo)
        
        # Restaurar archivos de configuración
        for archivo in latest_backup.glob("*.py"):
            dest = Path(__file__).parent / archivo.name
            shutil.copy2(archivo, dest)
        
        # Restaurar certificados
        if cert_backup.exists():
            dest_cert_dir = Path(__file__).parent / "certificados"
            dest_cert_dir.mkdir(exist_ok=True)
            
            for cert_file in cert_backup.glob("*"):
                if cert_file.is_file() and cert_file.name != "metadata.json":
                    shutil.copy2(cert_file, dest_cert_dir / cert_file.name)
        
        return {
            "success": True,
            "backup_file": latest_backup.name,
            "backup_date": metadata.get("timestamp", "Desconocida"),
            "archivos_restaurados": metadata.get("archivos", []),
            "backup_previo_creado": current_backup_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al restaurar backup: {str(e)}")


# ============================================================================
# DESCARGAR ARCHIVOS DOCUMENTO SOPORTE (XML/ZIP)
# ============================================================================

@app.get("/api/documento-soporte/download/{tipo}/{ambiente}/{doc_numero}")
async def download_documento_soporte(tipo: str, ambiente: str, doc_numero: str):
    """
    Descarga archivos generados del documento soporte
    
    Args:
        tipo: 'xml' o 'zip'
        ambiente: 'produccion' o 'habilitacion'
        doc_numero: Número del documento (ej: DCSW5)
    
    Returns:
        FileResponse con el archivo solicitado
    """
    try:
        # Validar tipo
        if tipo not in ['xml', 'zip']:
            raise HTTPException(status_code=400, detail="Tipo debe ser 'xml' o 'zip'")
        
        # Validar ambiente
        if ambiente not in ['produccion', 'habilitacion']:
            raise HTTPException(status_code=400, detail="Ambiente debe ser 'produccion' o 'habilitacion'")
        
        # Construir ruta del archivo
        if ambiente == 'produccion':
            if tipo == 'xml':
                file_path = f"/tmp/ds_prod_{doc_numero}_firmado.xml"
            else:
                file_path = f"/tmp/ds_prod_{doc_numero}.zip"
        else:
            if tipo == 'xml':
                file_path = f"/tmp/ds_{doc_numero}_firmada.xml"
            else:
                file_path = f"/tmp/ds_{doc_numero}.zip"
        
        # Verificar que existe el archivo
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Archivo no encontrado: {file_path}. El documento puede haber expirado o no fue generado correctamente."
            )
        
        # Determinar media type
        if tipo == 'xml':
            media_type = 'application/xml'
            filename = f"documento_soporte_{doc_numero}.xml"
        else:
            media_type = 'application/zip'
            filename = f"documento_soporte_{doc_numero}.zip"
        
        return FileResponse(
            file_path,
            media_type=media_type,
            filename=filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al descargar archivo: {str(e)}")


@app.get("/api/dian/documentos/{nit}/{filename}")
async def download_documento_por_nit(nit: str, filename: str):
    """
    Descarga documentos DIAN guardados permanentemente por empresa
    
    Los archivos están en: certificados/{NIT}/documentos/{filename}
    
    Args:
        nit: NIT de la empresa
        filename: Nombre del archivo (ej: ds_prod_DCSW5_firmado.xml)
    
    Returns:
        FileResponse con el archivo solicitado
    """
    try:
        # Construir ruta del archivo
        base_path = Path(__file__).parent / "certificados" / nit / "documentos"
        file_path = base_path / filename
        
        # Verificar que existe el archivo
        if not file_path.exists():
            raise HTTPException(
                status_code=404, 
                detail=f"Archivo no encontrado para empresa {nit}: {filename}"
            )
        
        # Determinar media type basado en extensión
        if filename.endswith('.xml'):
            media_type = 'application/xml'
        elif filename.endswith('.zip'):
            media_type = 'application/zip'
        elif filename.endswith('.pdf'):
            media_type = 'application/pdf'
        else:
            media_type = 'application/octet-stream'
        
        return FileResponse(
            str(file_path),
            media_type=media_type,
            filename=filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al descargar archivo: {str(e)}")


@app.get("/api/dian/documentos/{nit}/{consecutivo}/timbrado")
async def get_timbrado_dian(nit: str, consecutivo: str):
    """
    Descarga el "timbrado" - la respuesta de validación de la DIAN.
    
    El timbrado contiene:
    - XmlDocumentKey (CUDS) - Hash SHA-384 de validación
    - IsValid - Si fue aceptado
    - StatusCode - Código de estado
    - StatusDescription - Descripción
    - Fecha y hora de la validación
    - QRCode para verificación
    
    Args:
        nit: NIT de la empresa
        consecutivo: Consecutivo del documento (ej: DCSW1, SEDS5)
    
    Returns:
        JSON con la información de validación o FileResponse si no es JSON
    """
    try:
        import json as json_module
        base_path = Path(__file__).parent / "certificados" / nit / "documentos"
        
        # Buscar archivo de validación JSON (producción o habilitación)
        json_patterns = [
            f"ds_prod_validacion_{consecutivo}.json",
            f"ds_habi_validacion_{consecutivo}.json",
            f"validacion_{consecutivo}.json"
        ]
        
        json_file = None
        for pattern in json_patterns:
            potential_file = base_path / pattern
            if potential_file.exists():
                json_file = potential_file
                break
        
        if json_file:
            # Retornar el JSON de validación
            with open(json_file, 'r', encoding='utf-8') as f:
                validacion_data = json_module.load(f)
            return validacion_data
        
        # Si no hay JSON, buscar el ZIP que contiene el XML firmado
        # El ZIP es "técnicamente" el timbrado (documento firmado y enviado)
        zip_patterns = [
            f"ds_prod_{consecutivo}.zip",
            f"ds_habi_{consecutivo}.zip",
            f"{consecutivo}.zip"
        ]
        
        for pattern in zip_patterns:
            potential_file = base_path / pattern
            if potential_file.exists():
                return FileResponse(
                    str(potential_file),
                    media_type='application/zip',
                    filename=pattern
                )
        
        # Si no encuentra nada
        raise HTTPException(
            status_code=404,
            detail=f"No se encontró timbrado para documento {consecutivo} de empresa {nit}. "
                   f"Busque manualmente en: {base_path}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener timbrado: {str(e)}")


@app.get("/api/dian/documentos/{nit}/{filename}/pdf")
async def generate_pdf_from_xml(nit: str, filename: str):
    """
    Genera un PDF profesional con formato oficial DIAN (Representación Gráfica).
    
    DISEÑO PROFESIONAL que incluye:
    - Encabezado con logo y datos de la empresa emisora
    - CUDS prominente con estilo de sello oficial
    - Datos del documento claramente organizados
    - Información del adquirente y vendedor con diseño de tarjeta
    - Tabla de productos con estilo profesional
    - Sección de totales clara y visible
    - QR code de verificación DIAN
    - Pie de página con información de resolución
    - Texto de validación DIAN
    """
    try:
        from reportlab.lib.pagesizes import letter, A4
        from reportlab.lib.units import inch, cm, mm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, 
            Image, HRFlowable, KeepTogether, PageBreak
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
        from reportlab.pdfgen import canvas
        import xml.etree.ElementTree as ET
        import qrcode
        from io import BytesIO
        import tempfile
        from datetime import datetime
        
        # Construir ruta del XML
        base_path = Path(__file__).parent / "certificados" / nit / "documentos"
        
        if filename.endswith('.xml'):
            xml_file = base_path / filename
        else:
            xml_file = base_path / f"{filename}.xml"
        
        # Si no está en documentos, buscar en /tmp/ (nota crédito/ajuste)
        if not xml_file.exists():
            tmp_file = Path("/tmp") / (filename if filename.endswith('.xml') else f"{filename}.xml")
            if tmp_file.exists():
                xml_file = tmp_file
            else:
                raise HTTPException(status_code=404, detail=f"Archivo XML no encontrado: {filename}")
        
        # Parsear el XML
        tree = ET.parse(str(xml_file))
        root = tree.getroot()
        
        # Namespaces del XML DIAN
        ns = {
            'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
            'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
            'ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
            'sts': 'dian:gov:co:facturaelectronica:Structures-2-1',
            'ds': 'http://www.w3.org/2000/09/xmldsig#',
            'xades': 'http://uri.etsi.org/01903/v1.3.2#'
        }
        
        def get_text(xpath, default=''):
            elem = root.find(xpath, ns)
            return elem.text if elem is not None and elem.text else default
        
        def get_attr(xpath, attr, default=''):
            elem = root.find(xpath, ns)
            return elem.get(attr, default) if elem is not None else default
        
        # =====================================================================
        # EXTRAER TODOS LOS DATOS DEL XML
        # =====================================================================
        
        # Datos básicos del documento
        cuds = get_text('.//cbc:UUID')
        consecutivo = get_text('.//cbc:ID')
        fecha_emision = get_text('.//cbc:IssueDate')
        hora_emision = get_text('.//cbc:IssueTime', '00:00:00')
        moneda = get_text('.//cbc:DocumentCurrencyCode', 'COP')
        
        # Tipo de documento - detectar si es CreditNote o Invoice
        root_tag = root.tag.split('}')[-1] if '}' in root.tag else root.tag
        es_nota_credito = (root_tag == 'CreditNote')
        tipo_doc_code = get_text('.//cbc:CreditNoteTypeCode', '') or get_text('.//cbc:InvoiceTypeCode', '05')
        if es_nota_credito or tipo_doc_code == '95':
            tipo_documento = "NOTA DE AJUSTE AL DOCUMENTO SOPORTE EN ADQUISICIONES\nEFECTUADAS A SUJETOS NO OBLIGADOS A\nEXPEDIR FACTURA O\nDOCUMENTO EQUIVALENTE"
            tipo_doc_label = "NOTA DE AJUSTE"
        else:
            tipo_documento = "DOCUMENTO SOPORTE EN ADQUISICIONES EFECTUADAS A NO OBLIGADOS A FACTURAR"
            tipo_doc_label = "DOCUMENTO SOPORTE"
        
        # Datos de referencia al documento original (solo para notas de ajuste)
        ref_doc_id = ''
        ref_doc_fecha = ''
        ref_doc_cuds = ''
        ref_response_code = ''
        ref_description = ''
        if es_nota_credito:
            ref_doc_id = get_text('.//cac:BillingReference//cac:InvoiceDocumentReference//cbc:ID', '')
            ref_doc_fecha = get_text('.//cac:BillingReference//cac:InvoiceDocumentReference//cbc:IssueDate', '')
            ref_doc_cuds = get_text('.//cac:BillingReference//cac:InvoiceDocumentReference//cbc:UUID', '')
            ref_response_code = get_text('.//cac:DiscrepancyResponse//cbc:ResponseCode', '')
            ref_description = get_text('.//cac:DiscrepancyResponse//cbc:Description', '')
            RESPONSE_CODES_MAP = {
                '1': 'Devolución parcial de bienes / No aceptación parcial del servicio',
                '2': 'Anulación del documento soporte',
                '3': 'Rebaja o descuento parcial o total',
                '4': 'Ajuste de precio',
                '5': 'Otros'
            }
            if not ref_description:
                ref_description = RESPONSE_CODES_MAP.get(ref_response_code, 'Anulación')
        
        # Fecha de firma/validación (xades:SigningTime)
        fecha_firma = get_text('.//xades:SigningTime', '')
        fecha_validacion_dian = None
        if fecha_firma:
            try:
                from datetime import timezone, timedelta
                dt = datetime.fromisoformat(fecha_firma.replace('Z', '+00:00'))
                colombia_tz = timezone(timedelta(hours=-5))
                dt_colombia = dt.astimezone(colombia_tz)
                fecha_validacion_dian = dt_colombia.strftime('%Y-%m-%d %H:%M:%S COT')
            except:
                fecha_validacion_dian = fecha_firma
        else:
            fecha_validacion_dian = f"{fecha_emision} {hora_emision}"
        
        # Resolución y autorización
        resolucion = get_text('.//sts:InvoiceAuthorization', '')
        prefijo = get_text('.//sts:AuthorizedInvoices//sts:Prefix', '')
        rango_desde = get_text('.//sts:AuthorizedInvoices//sts:From', '')
        rango_hasta = get_text('.//sts:AuthorizedInvoices//sts:To', '')
        vigencia_desde = get_text('.//sts:AuthorizationPeriod//cbc:StartDate', '')
        vigencia_hasta = get_text('.//sts:AuthorizationPeriod//cbc:EndDate', '')
        
        # =====================================================================
        # ADQUIRENTE (AccountingCustomerParty) - La empresa que compra/paga
        # =====================================================================
        adq_nit = get_text('.//cac:AccountingCustomerParty//cbc:CompanyID')
        adq_dv = get_attr('.//cac:AccountingCustomerParty//cbc:CompanyID', 'schemeID', '')
        adq_nombre = get_text('.//cac:AccountingCustomerParty//cbc:RegistrationName')
        adq_tipo_persona = get_text('.//cac:AccountingCustomerParty//cbc:AdditionalAccountID', '1')
        adq_regimen = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cbc:TaxLevelCode', 'O-13')
        adq_responsabilidad = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cac:TaxScheme//cbc:Name', 'IVA')
        adq_email = get_text('.//cac:AccountingCustomerParty//cac:Party//cac:Contact//cbc:ElectronicMail', '')
        adq_telefono = get_text('.//cac:AccountingCustomerParty//cac:Party//cac:Contact//cbc:Telephone', '')
        # Dirección del adquirente
        adq_pais = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cac:RegistrationAddress//cac:Country//cbc:Name', 'Colombia')
        adq_depto = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cac:RegistrationAddress//cbc:CountrySubentity', '')
        adq_ciudad = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cac:RegistrationAddress//cbc:CityName', '')
        adq_direccion = get_text('.//cac:AccountingCustomerParty//cac:PartyTaxScheme//cac:RegistrationAddress//cac:AddressLine//cbc:Line', '')
        
        # =====================================================================
        # VENDEDOR/BENEFICIARIO (AccountingSupplierParty) - Quien recibe el pago
        # =====================================================================
        ven_nit = get_text('.//cac:AccountingSupplierParty//cbc:CompanyID')
        ven_dv = get_attr('.//cac:AccountingSupplierParty//cbc:CompanyID', 'schemeID', '')
        ven_tipo_doc = get_attr('.//cac:AccountingSupplierParty//cbc:CompanyID', 'schemeName', 'NIT')
        ven_nombre = get_text('.//cac:AccountingSupplierParty//cbc:RegistrationName')
        ven_tipo_persona = get_text('.//cac:AccountingSupplierParty//cbc:AdditionalAccountID', '2')
        ven_regimen = get_text('.//cac:AccountingSupplierParty//cac:PartyTaxScheme//cbc:TaxLevelCode', 'R-99-PN')
        ven_responsabilidad = get_text('.//cac:AccountingSupplierParty//cac:PartyTaxScheme//cac:TaxScheme//cbc:Name', 'No aplica')
        ven_email = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:Contact//cbc:ElectronicMail', '')
        ven_telefono = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:Contact//cbc:Telephone', '')
        # Dirección del vendedor
        ven_pais = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:PhysicalLocation//cac:Address//cac:Country//cbc:Name', 'Colombia')
        ven_depto = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:PhysicalLocation//cac:Address//cbc:CountrySubentity', '')
        ven_ciudad = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:PhysicalLocation//cac:Address//cbc:CityName', '')
        ven_direccion = get_text('.//cac:AccountingSupplierParty//cac:Party//cac:PhysicalLocation//cac:Address//cac:AddressLine//cbc:Line', '')
        
        # Forma y medio de pago
        forma_pago = get_text('.//cac:PaymentMeans//cbc:PaymentMeansCode', '1')
        forma_pago_texto = {'1': 'Contado', '2': 'Crédito'}.get(forma_pago, forma_pago)
        medio_pago = get_text('.//cac:PaymentMeans//cbc:PaymentID', '10')
        medios_pago = {
            '10': 'Efectivo', '20': 'Cheque', '42': 'Consignación bancaria',
            '47': 'Transferencia débito', '48': 'Tarjeta crédito', '49': 'Tarjeta débito'
        }
        medio_pago_texto = medios_pago.get(medio_pago, medio_pago)
        fecha_vencimiento = get_text('.//cac:PaymentMeans//cbc:PaymentDueDate', fecha_emision)
        
        # Líneas de productos - usar CreditNoteLine o InvoiceLine según tipo
        line_tag = 'cac:CreditNoteLine' if es_nota_credito else 'cac:InvoiceLine'
        qty_tag = 'cbc:CreditedQuantity' if es_nota_credito else 'cbc:InvoicedQuantity'
        lineas = []
        for idx, line in enumerate(root.findall(f'.//{line_tag}', ns), 1):
            codigo = line.find('.//cac:Item//cac:StandardItemIdentification//cbc:ID', ns)
            codigo_unspsc = line.find('.//cac:Item//cac:CommodityClassification//cbc:ItemClassificationCode', ns)
            descripcion = line.find('.//cbc:Description', ns) or line.find('.//cac:Item//cbc:Description', ns)
            cantidad = line.find(f'.//{qty_tag}', ns)
            unidad = cantidad.get('unitCode', '94') if cantidad is not None else '94'
            precio = line.find('.//cac:Price//cbc:PriceAmount', ns)
            valor_linea = line.find('.//cbc:LineExtensionAmount', ns)
            
            # Mapeo de unidades
            unidades_map = {
                '94': 'Unidad', 'C62': 'Unidad', 'EA': 'Unidad',
                'KGM': 'Kg', 'LTR': 'Lt', 'MTR': 'Mt', 'GRM': 'Gr',
                'MTK': 'm²', 'MTQ': 'm³', 'HUR': 'Hora'
            }
            
            lineas.append({
                'nro': idx,
                'codigo': codigo.text if codigo is not None else '',
                'codigo_unspsc': codigo_unspsc.text if codigo_unspsc is not None else '',
                'descripcion': descripcion.text if descripcion is not None else '',
                'unidad': unidades_map.get(unidad, unidad),
                'unidad_code': unidad,
                'cantidad': float(cantidad.text) if cantidad is not None and cantidad.text else 1,
                'precio': float(precio.text) if precio is not None and precio.text else 0,
                'valor': float(valor_linea.text) if valor_linea is not None and valor_linea.text else 0
            })
        
        # Totales
        subtotal = float(get_text('.//cac:LegalMonetaryTotal//cbc:LineExtensionAmount', '0'))
        descuento = float(get_text('.//cac:LegalMonetaryTotal//cbc:AllowanceTotalAmount', '0'))
        recargo = float(get_text('.//cac:LegalMonetaryTotal//cbc:ChargeTotalAmount', '0'))
        base_gravable = float(get_text('.//cac:LegalMonetaryTotal//cbc:TaxExclusiveAmount', '0'))
        total_iva = float(get_text('.//cac:TaxTotal//cbc:TaxAmount', '0'))
        total_documento = float(get_text('.//cac:LegalMonetaryTotal//cbc:PayableAmount', '0'))
        
        # Retenciones
        retencion_renta = 0.0
        retencion_iva = 0.0
        for withholding in root.findall('.//cac:WithholdingTaxTotal', ns):
            tax_name = withholding.find('.//cac:TaxCategory//cac:TaxScheme//cbc:Name', ns)
            tax_amount = withholding.find('.//cbc:TaxAmount', ns)
            if tax_name is not None and tax_amount is not None:
                if 'renta' in tax_name.text.lower() or tax_name.text == '06':
                    retencion_renta = float(tax_amount.text)
                elif 'iva' in tax_name.text.lower():
                    retencion_iva = float(tax_amount.text)
        
        # QR Code
        qr_url = get_text('.//sts:QRCode', '')
        
        # Notas adicionales
        notas = []
        for nota in root.findall('.//cbc:Note', ns):
            if nota.text:
                notas.append(nota.text)
        
        # =====================================================================
        # CREAR PDF PROFESIONAL
        # =====================================================================
        
        pdf_buffer = BytesIO()
        
        # Usar tamaño carta
        page_width, page_height = letter
        
        doc = SimpleDocTemplate(
            pdf_buffer, 
            pagesize=letter,
            leftMargin=0.6*inch, 
            rightMargin=0.6*inch,
            topMargin=0.4*inch, 
            bottomMargin=0.5*inch
        )
        
        styles = getSampleStyleSheet()
        
        # =====================================================================
        # PALETA DE COLORES PROFESIONAL DIAN
        # =====================================================================
        VERDE_DIAN = colors.HexColor('#00923f')          # Verde institucional DIAN
        VERDE_CLARO = colors.HexColor('#e8f5e9')         # Verde muy claro para fondos
        VERDE_TITULO = colors.HexColor('#1b5e20')        # Verde oscuro para títulos
        AZUL_CORPORATIVO = colors.HexColor('#1565c0')    # Azul para acentos
        GRIS_OSCURO = colors.HexColor('#212121')         # Texto principal
        GRIS_MEDIO = colors.HexColor('#616161')          # Texto secundario
        GRIS_CLARO = colors.HexColor('#9e9e9e')          # Bordes y líneas
        FONDO_CLARO = colors.HexColor('#fafafa')         # Fondo alternativo
        AMARILLO_ALERTA = colors.HexColor('#fff3e0')     # Para notas
        
        # =====================================================================
        # ESTILOS TIPOGRÁFICOS
        # =====================================================================
        
        # Título principal del documento
        titulo_doc_style = ParagraphStyle(
            'TituloDoc', 
            parent=styles['Heading1'], 
            fontSize=14, 
            textColor=VERDE_TITULO, 
            alignment=TA_CENTER, 
            spaceAfter=6,
            fontName='Helvetica-Bold'
        )
        
        # Subtítulo
        subtitulo_style = ParagraphStyle(
            'Subtitulo', 
            parent=styles['Normal'], 
            fontSize=10, 
            textColor=GRIS_OSCURO, 
            alignment=TA_CENTER, 
            spaceAfter=4
        )
        
        # Encabezado de sección
        seccion_style = ParagraphStyle(
            'Seccion', 
            parent=styles['Heading2'], 
            fontSize=10, 
            textColor=colors.white, 
            spaceBefore=12, 
            spaceAfter=4,
            fontName='Helvetica-Bold',
            backColor=VERDE_DIAN,
            borderPadding=(4, 6, 4, 6)
        )
        
        # Subsección
        subseccion_style = ParagraphStyle(
            'Subseccion',
            parent=styles['Normal'],
            fontSize=9,
            textColor=VERDE_TITULO,
            fontName='Helvetica-Bold',
            spaceBefore=6,
            spaceAfter=2
        )
        
        # Texto normal
        normal_style = ParagraphStyle(
            'NormalCustom', 
            parent=styles['Normal'], 
            fontSize=8, 
            textColor=GRIS_OSCURO,
            leading=10
        )
        
        # Texto pequeño
        small_style = ParagraphStyle(
            'Small', 
            parent=styles['Normal'], 
            fontSize=7, 
            textColor=GRIS_MEDIO,
            leading=9
        )
        
        # Texto de etiqueta (labels)
        label_style = ParagraphStyle(
            'Label',
            parent=styles['Normal'],
            fontSize=7,
            textColor=GRIS_MEDIO,
            fontName='Helvetica-Bold'
        )
        
        # Texto de valor (datos)
        value_style = ParagraphStyle(
            'Value',
            parent=styles['Normal'],
            fontSize=8,
            textColor=GRIS_OSCURO
        )
        
        # Texto grande para totales
        total_style = ParagraphStyle(
            'Total',
            parent=styles['Normal'],
            fontSize=11,
            textColor=VERDE_TITULO,
            fontName='Helvetica-Bold',
            alignment=TA_RIGHT
        )
        
        # CUDS estilo
        cuds_style = ParagraphStyle(
            'CUDS',
            parent=styles['Normal'],
            fontSize=6,
            textColor=GRIS_OSCURO,
            fontName='Courier',
            alignment=TA_CENTER,
            leading=8
        )
        
        # Pie de página
        footer_style = ParagraphStyle(
            'Footer',
            parent=styles['Normal'],
            fontSize=6,
            textColor=GRIS_MEDIO,
            alignment=TA_CENTER
        )
        
        elements = []
        
        # =====================================================================
        # ENCABEZADO PRINCIPAL
        # =====================================================================
        
        # Logo y nombre de empresa (lado izquierdo) + Número documento (lado derecho)
        empresa_info = f"""<font size="12"><b>{adq_nombre}</b></font><br/>
<font size="8">NIT: {adq_nit}-{adq_dv}</font><br/>
<font size="7">{adq_direccion}</font><br/>
<font size="7">{adq_ciudad}, {adq_depto} - {adq_pais}</font>"""
        
        if adq_email:
            empresa_info += f"""<br/><font size="7">Email: {adq_email}</font>"""
        if adq_telefono:
            empresa_info += f"""<br/><font size="7">Tel: {adq_telefono}</font>"""
        
        # Número de documento destacado
        doc_numero_box = f"""<font size="10" color="#00923f"><b>{tipo_doc_label}</b></font><br/>
<font size="16" color="#1b5e20"><b>{consecutivo}</b></font><br/>
<font size="8">Fecha: {fecha_emision}</font><br/>
<font size="7">Hora: {hora_emision}</font>"""
        
        header_data = [
            [
                Paragraph(empresa_info, normal_style),
                Paragraph(doc_numero_box, ParagraphStyle('DocNum', alignment=TA_RIGHT, fontSize=10))
            ]
        ]
        header_table = Table(header_data, colWidths=[4*inch, 3*inch])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 8))
        
        # Línea separadora verde
        elements.append(HRFlowable(width="100%", thickness=2, color=VERDE_DIAN, spaceAfter=6))
        
        # Título del tipo de documento
        elements.append(Paragraph(f"<b>{tipo_documento}</b>", titulo_doc_style))
        elements.append(Paragraph("Representación Gráfica del Documento Electrónico", subtitulo_style))
        elements.append(Spacer(1, 6))
        
        # =====================================================================
        # CUDS - CÓDIGO ÚNICO DE DOCUMENTO SOPORTE (destacado)
        # =====================================================================
        cuds_label = "CÓDIGO ÚNICO DE DOCUMENTO SOPORTE - CUDS" if not es_nota_credito else "CÓDIGO ÚNICO DE NOTA DE AJUSTE - CUDS"
        cuds_header = Table(
            [[Paragraph(f"<b>{cuds_label}</b>", 
                        ParagraphStyle('CUDSHeader', fontSize=8, textColor=colors.white, 
                                       alignment=TA_CENTER, fontName='Helvetica-Bold'))]],
            colWidths=[7*inch]
        )
        cuds_header.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_DIAN),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(cuds_header)
        
        # CUDS value
        cuds_value = Table(
            [[Paragraph(f"<font face='Courier' size='7'>{cuds}</font>", cuds_style)]],
            colWidths=[7*inch]
        )
        cuds_value.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_CLARO),
            ('BOX', (0, 0), (-1, -1), 1, VERDE_DIAN),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(cuds_value)
        elements.append(Spacer(1, 10))
        
        # =====================================================================
        # DATOS DEL DOCUMENTO
        # =====================================================================
        doc_section = Table(
            [[Paragraph("<b>INFORMACIÓN DEL DOCUMENTO</b>", 
                        ParagraphStyle('SecHeader', fontSize=9, textColor=colors.white, 
                                       alignment=TA_LEFT, fontName='Helvetica-Bold'))]],
            colWidths=[7*inch]
        )
        doc_section.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_DIAN),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(doc_section)
        
        # Información del documento en tabla organizada
        doc_info = [
            [Paragraph("<b>Número:</b>", label_style), Paragraph(consecutivo, value_style),
             Paragraph("<b>Fecha emisión:</b>", label_style), Paragraph(fecha_emision, value_style),
             Paragraph("<b>Hora:</b>", label_style), Paragraph(hora_emision, value_style)],
            [Paragraph("<b>Forma de pago:</b>", label_style), Paragraph(forma_pago_texto, value_style),
             Paragraph("<b>Medio de pago:</b>", label_style), Paragraph(medio_pago_texto, value_style),
             Paragraph("<b>Vencimiento:</b>", label_style), Paragraph(fecha_vencimiento, value_style)],
            [Paragraph("<b>Moneda:</b>", label_style), Paragraph(moneda, value_style),
             Paragraph("<b>Prefijo:</b>", label_style), Paragraph(prefijo, value_style),
             Paragraph("<b>Resolución:</b>", label_style), Paragraph(resolucion, value_style)],
        ]
        doc_table = Table(doc_info, colWidths=[0.9*inch, 1.1*inch, 1*inch, 1*inch, 0.9*inch, 1.1*inch])
        doc_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('BACKGROUND', (0, 0), (-1, -1), FONDO_CLARO),
            ('BOX', (0, 0), (-1, -1), 0.5, GRIS_CLARO),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, GRIS_CLARO),
        ]))
        elements.append(doc_table)
        elements.append(Spacer(1, 10))
        
        # =====================================================================
        # DATOS DEL ADQUIRENTE (Empresa que emite el DS)
        # =====================================================================
        adq_section = Table(
            [[Paragraph("<b>ADQUIRENTE (Quien emite el documento)</b>", 
                        ParagraphStyle('SecHeader', fontSize=9, textColor=colors.white, 
                                       alignment=TA_LEFT, fontName='Helvetica-Bold'))]],
            colWidths=[7*inch]
        )
        adq_section.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), AZUL_CORPORATIVO),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(adq_section)
        
        tipo_persona_adq = 'Persona Jurídica' if adq_tipo_persona == '1' else 'Persona Natural'
        adq_info = [
            [Paragraph("<b>Razón Social:</b>", label_style), 
             Paragraph(f"<b>{adq_nombre}</b>", ParagraphStyle('BoldValue', fontSize=9, textColor=GRIS_OSCURO, fontName='Helvetica-Bold')),
             '', ''],
            [Paragraph("<b>NIT:</b>", label_style), Paragraph(f"{adq_nit}-{adq_dv}", value_style),
             Paragraph("<b>Tipo:</b>", label_style), Paragraph(tipo_persona_adq, value_style)],
            [Paragraph("<b>Régimen:</b>", label_style), Paragraph(adq_regimen, value_style),
             Paragraph("<b>Responsabilidad:</b>", label_style), Paragraph(adq_responsabilidad, value_style)],
            [Paragraph("<b>Dirección:</b>", label_style), Paragraph(adq_direccion, value_style),
             Paragraph("<b>Ciudad:</b>", label_style), Paragraph(f"{adq_ciudad}, {adq_depto}", value_style)],
        ]
        adq_table = Table(adq_info, colWidths=[1*inch, 2.5*inch, 1*inch, 2.5*inch])
        adq_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('SPAN', (1, 0), (3, 0)),
            ('BOX', (0, 0), (-1, -1), 0.5, GRIS_CLARO),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, GRIS_CLARO),
        ]))
        elements.append(adq_table)
        elements.append(Spacer(1, 10))
        
        # =====================================================================
        # DATOS DEL VENDEDOR/BENEFICIARIO (SNO - Sujeto No Obligado)
        # =====================================================================
        ven_section = Table(
            [[Paragraph("<b>VENDEDOR / BENEFICIARIO (Sujeto No Obligado a Facturar)</b>", 
                        ParagraphStyle('SecHeader', fontSize=9, textColor=colors.white, 
                                       alignment=TA_LEFT, fontName='Helvetica-Bold'))]],
            colWidths=[7*inch]
        )
        ven_section.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_TITULO),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(ven_section)
        
        tipo_persona_ven = 'Persona Natural' if ven_tipo_persona == '2' else 'Persona Jurídica'
        tipo_doc_display = {'31': 'NIT', '13': 'Cédula Ciudadanía', '22': 'Cédula Extranjería', 
                           '41': 'Pasaporte', '42': 'Documento Extranjero'}.get(str(ven_tipo_doc), ven_tipo_doc)
        
        ven_info = [
            [Paragraph("<b>Nombre/Razón Social:</b>", label_style), 
             Paragraph(f"<b>{ven_nombre}</b>", ParagraphStyle('BoldValue', fontSize=9, textColor=GRIS_OSCURO, fontName='Helvetica-Bold')),
             '', ''],
            [Paragraph("<b>Tipo documento:</b>", label_style), Paragraph(tipo_doc_display, value_style),
             Paragraph("<b>Número:</b>", label_style), Paragraph(f"{ven_nit}{'-' + ven_dv if ven_dv else ''}", value_style)],
            [Paragraph("<b>Tipo persona:</b>", label_style), Paragraph(tipo_persona_ven, value_style),
             Paragraph("<b>Régimen:</b>", label_style), Paragraph(ven_regimen, value_style)],
            [Paragraph("<b>Dirección:</b>", label_style), Paragraph(ven_direccion or 'No especificada', value_style),
             Paragraph("<b>Ciudad:</b>", label_style), Paragraph(f"{ven_ciudad}, {ven_depto}" if ven_ciudad else ven_pais, value_style)],
        ]
        if ven_email or ven_telefono:
            ven_info.append([
                Paragraph("<b>Email:</b>", label_style), Paragraph(ven_email or 'N/A', value_style),
                Paragraph("<b>Teléfono:</b>", label_style), Paragraph(ven_telefono or 'N/A', value_style)
            ])
        
        ven_table = Table(ven_info, colWidths=[1.1*inch, 2.4*inch, 1*inch, 2.5*inch])
        ven_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('SPAN', (1, 0), (3, 0)),
            ('BOX', (0, 0), (-1, -1), 0.5, GRIS_CLARO),
            ('INNERGRID', (0, 0), (-1, -1), 0.25, GRIS_CLARO),
        ]))
        elements.append(ven_table)
        elements.append(Spacer(1, 10))
        
        # =====================================================================
        # REFERENCIAS (solo para Notas de Ajuste)
        # =====================================================================
        if es_nota_credito and ref_doc_id:
            ref_section = Table(
                [[Paragraph("<b>REFERENCIAS - DOCUMENTO ORIGINAL AFECTADO</b>", 
                            ParagraphStyle('SecHeader', fontSize=9, textColor=colors.white, 
                                           alignment=TA_LEFT, fontName='Helvetica-Bold'))]],
                colWidths=[7*inch]
            )
            ref_section.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#c62828')),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ]))
            elements.append(ref_section)
            
            ref_info = [
                [Paragraph("<b>Tipo documento:</b>", label_style), Paragraph('05 - Documento Soporte', value_style),
                 Paragraph("<b>Consecutivo:</b>", label_style), Paragraph(ref_doc_id, value_style)],
                [Paragraph("<b>Fecha emisión:</b>", label_style), Paragraph(ref_doc_fecha, value_style),
                 Paragraph("<b>Motivo:</b>", label_style), Paragraph(f"({ref_response_code}) {ref_description}", value_style)],
            ]
            if ref_doc_cuds:
                ref_info.append([
                    Paragraph("<b>CUDS original:</b>", label_style), 
                    Paragraph(f"<font face='Courier' size='5'>{ref_doc_cuds}</font>", small_style),
                    '', ''
                ])
            
            ref_table = Table(ref_info, colWidths=[1.1*inch, 2.4*inch, 1*inch, 2.5*inch])
            ref_table_style = [
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                ('BOX', (0, 0), (-1, -1), 0.5, GRIS_CLARO),
                ('INNERGRID', (0, 0), (-1, -1), 0.25, GRIS_CLARO),
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#ffebee')),
            ]
            if ref_doc_cuds:
                ref_table_style.append(('SPAN', (1, 2), (3, 2)))
            ref_table.setStyle(TableStyle(ref_table_style))
            elements.append(ref_table)
            elements.append(Spacer(1, 10))
        
        # =====================================================================
        # DETALLE DE CONCEPTOS/PRODUCTOS
        # =====================================================================
        prod_section = Table(
            [[Paragraph("<b>DETALLE DE CONCEPTOS</b>", 
                        ParagraphStyle('SecHeader', fontSize=9, textColor=colors.white, 
                                       alignment=TA_LEFT, fontName='Helvetica-Bold'))]],
            colWidths=[7*inch]
        )
        prod_section.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_DIAN),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(prod_section)
        
        # Encabezado de tabla de productos
        prod_header = [
            Paragraph("<b>#</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph("<b>Código</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph("<b>Descripción</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_LEFT)),
            Paragraph("<b>U/M</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph("<b>Cant.</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_CENTER)),
            Paragraph("<b>Precio Unit.</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_RIGHT)),
            Paragraph("<b>Total</b>", ParagraphStyle('TH', fontSize=7, textColor=colors.white, alignment=TA_RIGHT)),
        ]
        
        prod_data = [prod_header]
        for linea in lineas:
            prod_data.append([
                Paragraph(str(linea['nro']), ParagraphStyle('TD', fontSize=7, alignment=TA_CENTER)),
                Paragraph(linea['codigo'] or linea.get('codigo_unspsc', ''), ParagraphStyle('TD', fontSize=7, alignment=TA_CENTER)),
                Paragraph(linea['descripcion'], ParagraphStyle('TD', fontSize=7)),
                Paragraph(linea['unidad'], ParagraphStyle('TD', fontSize=7, alignment=TA_CENTER)),
                Paragraph(f"{linea['cantidad']:.2f}", ParagraphStyle('TD', fontSize=7, alignment=TA_CENTER)),
                Paragraph(f"${linea['precio']:,.2f}", ParagraphStyle('TD', fontSize=7, alignment=TA_RIGHT)),
                Paragraph(f"${linea['valor']:,.2f}", ParagraphStyle('TD', fontSize=7, alignment=TA_RIGHT, fontName='Helvetica-Bold')),
            ])
        
        prod_table = Table(prod_data, colWidths=[0.35*inch, 0.7*inch, 2.2*inch, 0.5*inch, 0.55*inch, 1*inch, 1*inch])
        prod_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), VERDE_TITULO),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, GRIS_CLARO),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, FONDO_CLARO]),
        ]))
        elements.append(prod_table)
        elements.append(Spacer(1, 10))
        
        # =====================================================================
        # TOTALES + QR CODE
        # =====================================================================
        
        # Generar QR Code
        qr_img_element = None
        if qr_url:
            try:
                qr = qrcode.QRCode(version=1, box_size=4, border=2)
                qr.add_data(qr_url)
                qr.make(fit=True)
                qr_img = qr.make_image(fill_color="black", back_color="white")
                qr_buffer = BytesIO()
                qr_img.save(qr_buffer, format='PNG')
                qr_buffer.seek(0)
                qr_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
                qr_temp.write(qr_buffer.getvalue())
                qr_temp.close()
                qr_img_element = Image(qr_temp.name, width=1.3*inch, height=1.3*inch)
            except Exception as qr_error:
                print(f"Error generando QR: {qr_error}")
        
        # Información de validación DIAN
        validacion_info = f"""<font size="8"><b>✓ Documento validado por la DIAN</b></font><br/>
<font size="7">Fecha validación: {fecha_validacion_dian}</font><br/><br/>
<font size="7"><b>Verificar documento en:</b></font><br/>
<font size="6" color="#1565c0">https://catalogo-vpfe.dian.gov.co</font><br/><br/>
<font size="7"><b>Generado por:</b> Software Propio</font><br/>
<font size="7"><b>NIT Proveedor:</b> {nit}</font>"""
        
        # Tabla de totales
        totales_data = [
            [Paragraph("<b>Subtotal:</b>", label_style), 
             Paragraph(f"${subtotal:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT))],
            [Paragraph("Descuentos:", small_style), 
             Paragraph(f"${descuento:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT))],
            [Paragraph("Recargos:", small_style), 
             Paragraph(f"${recargo:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT))],
        ]
        
        if retencion_renta > 0:
            totales_data.append([
                Paragraph("Retención Renta:", small_style),
                Paragraph(f"-${retencion_renta:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT, textColor=colors.red))
            ])
        
        if retencion_iva > 0:
            totales_data.append([
                Paragraph("Retención IVA:", small_style),
                Paragraph(f"-${retencion_iva:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT, textColor=colors.red))
            ])
        
        totales_data.append([
            Paragraph("IVA:", small_style),
            Paragraph(f"${total_iva:,.2f}", ParagraphStyle('TR', fontSize=8, alignment=TA_RIGHT))
        ])
        
        # Línea separadora antes del total
        totales_data.append([Paragraph("", small_style), Paragraph("", small_style)])
        
        # Total bruto del documento (PayableAmount según DIAN)
        totales_data.append([
            Paragraph("<b>TOTAL BRUTO:</b>", ParagraphStyle('TotalLabel', fontSize=9, fontName='Helvetica-Bold')),
            Paragraph(f"<b>${total_documento:,.2f} {moneda}</b>", total_style)
        ])
        
        # Si hay retenciones, mostrar el valor neto realmente entregado
        total_retenciones = retencion_renta + retencion_iva
        if total_retenciones > 0:
            valor_neto = total_documento - total_retenciones
            totales_data.append([Paragraph("", small_style), Paragraph("", small_style)])
            totales_data.append([
                Paragraph("<b>VALOR NETO<br/>ENTREGADO:</b>", ParagraphStyle('NetLabel', fontSize=10, fontName='Helvetica-Bold', textColor=colors.HexColor('#1b5e20'))),
                Paragraph(f"<b>${valor_neto:,.2f} {moneda}</b>", ParagraphStyle('NetTotal', fontSize=11, fontName='Helvetica-Bold', alignment=TA_RIGHT, textColor=colors.HexColor('#1b5e20')))
            ])
        
        totales_table = Table(totales_data, colWidths=[1.3*inch, 1.3*inch])
        
        # Estilo dinámico: si hay retenciones, destacar la última fila (valor neto)
        totales_style_cmds = [
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]
        
        if total_retenciones > 0:
            # La penúltima fila visible es TOTAL BRUTO, la última es VALOR NETO ENTREGADO
            totales_style_cmds.extend([
                ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#e8f5e9')),
                ('BOX', (0, -1), (-1, -1), 1.5, colors.HexColor('#1b5e20')),
            ])
        else:
            # Sin retenciones: destacar TOTAL BRUTO como total final
            totales_style_cmds.extend([
                ('LINEBELOW', (0, -2), (-1, -2), 1, VERDE_DIAN),
                ('BACKGROUND', (0, -1), (-1, -1), VERDE_CLARO),
                ('BOX', (0, -1), (-1, -1), 1, VERDE_DIAN),
            ])
        
        totales_table.setStyle(TableStyle(totales_style_cmds))
        
        # Combinar QR + Validación + Totales
        qr_cell = qr_img_element if qr_img_element else Paragraph("", normal_style)
        bottom_data = [[qr_cell, Paragraph(validacion_info, small_style), totales_table]]
        bottom_table = Table(bottom_data, colWidths=[1.6*inch, 2.5*inch, 2.9*inch])
        bottom_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (0, 0), 'CENTER'),
            ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
        ]))
        elements.append(bottom_table)
        elements.append(Spacer(1, 8))
        
        # =====================================================================
        # NOTAS (si las hay)
        # =====================================================================
        if notas:
            elements.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO, spaceBefore=4, spaceAfter=4))
            notas_text = "<b>Observaciones:</b><br/>" + "<br/>".join(notas)
            elements.append(Paragraph(notas_text, small_style))
            elements.append(Spacer(1, 4))
        
        # =====================================================================
        # PIE DE PÁGINA - INFORMACIÓN DE AUTORIZACIÓN
        # =====================================================================
        elements.append(HRFlowable(width="100%", thickness=1, color=VERDE_DIAN, spaceBefore=6, spaceAfter=6))
        
        # Información de resolución
        autorizacion_text = f"""<b>Autorización de numeración:</b> Resolución {resolucion} &nbsp; | &nbsp; 
<b>Prefijo:</b> {prefijo} &nbsp; | &nbsp; 
<b>Rango:</b> {rango_desde} al {rango_hasta} &nbsp; | &nbsp; 
<b>Vigencia:</b> {vigencia_desde} al {vigencia_hasta}"""
        elements.append(Paragraph(autorizacion_text, footer_style))
        
        # Mensaje de validación
        validacion_msg = """<i>Este documento fue validado por la DIAN. Para verificar su autenticidad, 
escanee el código QR o visite https://catalogo-vpfe.dian.gov.co</i>"""
        elements.append(Paragraph(validacion_msg, ParagraphStyle('ValidMsg', fontSize=6, 
                                                                   textColor=GRIS_MEDIO, alignment=TA_CENTER, 
                                                                   spaceBefore=4)))
        
        # Construir PDF
        doc.build(elements)
        pdf_buffer.seek(0)
        
        # Crear archivo temporal
        pdf_temp = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
        pdf_temp.write(pdf_buffer.getvalue())
        pdf_temp.close()
        
        pdf_filename = filename.replace('.xml', '.pdf').replace('_firmado', '')
        if not pdf_filename.endswith('.pdf'):
            pdf_filename = f"{pdf_filename}.pdf"
        
        return FileResponse(
            pdf_temp.name,
            media_type='application/pdf',
            filename=pdf_filename
        )
        
    except HTTPException:
        raise
    except ImportError as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Librerías de PDF no instaladas: {str(e)}. Instale: pip install reportlab qrcode pillow"
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generando PDF: {str(e)}")


# ============================================================================
# ENDPOINT: NOTA DE AJUSTE (NOTA CRÉDITO) PARA DOCUMENTO SOPORTE
# ============================================================================

class DocumentoOriginal(BaseModel):
    """Datos del documento soporte original a anular"""
    id: str = Field(..., description="Consecutivo del DS original (ej: SEDS1)")
    cuds: str = Field(..., description="CUDS del DS original (SHA-384)")
    fecha_emision: str = Field(..., description="Fecha de emisión del DS original")
    valor_total: float = Field(..., description="Valor total del DS original")
    concepto_descripcion: str = Field("BONO", description="Descripción del concepto")
    concepto_unspsc: str = Field("90121502", description="Código UNSPSC")
    prefijo: Optional[str] = Field(None, description="Prefijo del documento")
    numero: Optional[int] = Field(None, description="Número del documento")
    # Campos de retención
    tiene_retencion: bool = Field(False, description="Si el documento original tiene retención")
    porcentaje_retencion: float = Field(0, description="Porcentaje de retención (ej: 20)")
    valor_retencion: float = Field(0, description="Valor de la retención")
    base_gravable: float = Field(0, description="Base gravable para la retención")


class MotivoAnulacion(BaseModel):
    """Motivo de la anulación"""
    codigo: str = Field("2", description="Código de respuesta DIAN (1-5)")
    descripcion: str = Field(..., description="Descripción del motivo")


class BeneficiarioNA(BaseModel):
    """Datos del beneficiario/SNO"""
    nombres: str = Field(..., description="Nombres del beneficiario")
    apellidos: str = Field("", description="Apellidos del beneficiario")
    numero_documento: str = Field(..., description="Número de documento")
    tipo_documento: str = Field("13", description="Código tipo documento DIAN")
    es_residente: bool = Field(True, description="Si el beneficiario es residente colombiano")
    direccion: str = Field("Sin dirección", description="Dirección")
    ciudad_codigo: str = Field("05001", description="Código DANE ciudad")
    ciudad_nombre: str = Field("Medellín", description="Nombre ciudad")
    departamento_codigo: str = Field("05", description="Código DANE departamento")
    departamento_nombre: str = Field("Antioquia", description="Nombre departamento")
    email: str = Field("no-email@example.com", description="Email")
    telefono: str = Field("", description="Teléfono")
    pais: str = Field("CO", description="Código ISO país")
    pais_nombre: str = Field("Colombia", description="Nombre del país")
    estado_provincia: str = Field("", description="Estado/provincia para no residentes")


class BonoData(BaseModel):
    """Datos completos del bono para anulación"""
    documento_original: DocumentoOriginal
    motivo_anulacion: MotivoAnulacion
    beneficiario: BeneficiarioNA


class NotaAjusteRequest(BaseModel):
    """Datos para generar y enviar una Nota de Ajuste"""
    nit: str = Field(..., description="NIT de la empresa")
    bono_data: BonoData = Field(..., description="Datos del bono a anular")
    motivo: str = Field(..., description="Motivo de la anulación")
    response_code: str = Field("2", description="Código de respuesta DIAN (1-5)")
    ambiente: str = Field("habilitacion", description="Ambiente DIAN: habilitacion o produccion")
    consecutivo_nota_credito: str = Field(None, description="Consecutivo NC generado por el backend (ej: NC000001)")
    ds_original_ref: str = Field(None, description="Referencia al DS original (ej: DCNE000009)")


@app.post("/api/dian/nota-ajuste")
async def enviar_nota_ajuste(datos: NotaAjusteRequest):
    """
    Envía una Nota de Ajuste (Nota Crédito tipo 95) para anular un Documento Soporte
    
    Códigos de respuesta según DIAN:
    - 1: Devolución parcial de los bienes y/o no aceptación parcial del servicio
    - 2: Anulación del documento soporte en adquisiciones efectuadas a sujetos no obligados
    - 3: Rebaja o descuento parcial o total
    - 4: Ajuste de precio
    - 5: Otros
    """
    try:
        import subprocess
        import json
        import tempfile
        
        nit = datos.nit
        bono_data = datos.bono_data
        motivo = datos.motivo
        response_code = datos.response_code
        ambiente = datos.ambiente.lower() if datos.ambiente else "habilitacion"
        consecutivo_nc = datos.consecutivo_nota_credito  # Consecutivo generado por el backend
        ds_original_ref = datos.ds_original_ref  # Referencia al DS original
        
        # Validar código de respuesta
        if response_code not in ['1', '2', '3', '4', '5']:
            raise HTTPException(
                status_code=400,
                detail="Código de respuesta inválido. Debe ser 1, 2, 3, 4 o 5"
            )
        
        print(f"🚨 Iniciando anulación con Nota de Ajuste")
        print(f"🏢 Empresa NIT: {nit}")
        print(f"📄 DS Original: {bono_data.documento_original.id}")
        print(f"📋 CUDS Original: {bono_data.documento_original.cuds[:20]}...")
        print(f"📋 Motivo: {motivo}")
        print(f"📊 ResponseCode: {response_code}")
        print(f"🌍 Ambiente: {ambiente}")
        if consecutivo_nc:
            print(f"🔢 Consecutivo NC (backend): {consecutivo_nc}")
        if ds_original_ref:
            print(f"📌 DS Original Ref: {ds_original_ref}")
        
        # Verificar que existe la carpeta de configuración de la empresa
        empresa_config_dir = Path(__file__).parent / "certificados" / nit
        if not empresa_config_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"No existe configuración para la empresa NIT {nit}"
            )
        
        # Crear archivo JSON temporal con los datos
        json_data = {
            "documento_original": {
                "id": bono_data.documento_original.id,
                "cuds": bono_data.documento_original.cuds,
                "fecha_emision": bono_data.documento_original.fecha_emision,
                "valor_total": bono_data.documento_original.valor_total,
                "concepto_descripcion": bono_data.documento_original.concepto_descripcion,
                "concepto_unspsc": bono_data.documento_original.concepto_unspsc,
                # Datos de retención
                "tiene_retencion": bono_data.documento_original.tiene_retencion,
                "porcentaje_retencion": bono_data.documento_original.porcentaje_retencion,
                "valor_retencion": bono_data.documento_original.valor_retencion,
                "base_gravable": bono_data.documento_original.base_gravable
            },
            "motivo_anulacion": {
                "codigo": response_code,
                "descripcion": motivo
            },
            "beneficiario": {
                "nombres": bono_data.beneficiario.nombres,
                "apellidos": bono_data.beneficiario.apellidos,
                "numero_documento": bono_data.beneficiario.numero_documento,
                "tipo_documento": bono_data.beneficiario.tipo_documento,
                "es_residente": bono_data.beneficiario.es_residente,
                "direccion": bono_data.beneficiario.direccion,
                "ciudad_codigo": bono_data.beneficiario.ciudad_codigo,
                "ciudad_nombre": bono_data.beneficiario.ciudad_nombre,
                "departamento_codigo": bono_data.beneficiario.departamento_codigo,
                "departamento_nombre": bono_data.beneficiario.departamento_nombre,
                "email": bono_data.beneficiario.email,
                "telefono": bono_data.beneficiario.telefono,
                "pais": bono_data.beneficiario.pais,
                "pais_nombre": bono_data.beneficiario.pais_nombre,
                "estado_provincia": bono_data.beneficiario.estado_provincia
            },
            # Consecutivo generado por el backend (si se proporciona)
            "consecutivo_nota_credito": consecutivo_nc,
            "ds_original_ref": ds_original_ref
        }
        
        # Guardar JSON temporal
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(json_data, f, indent=2)
            json_temp_path = f.name
        
        print(f"📄 JSON temporal creado: {json_temp_path}")
        
        # Determinar qué script usar según el ambiente
        workspace = Path(__file__).parent
        if ambiente == "produccion":
            script_path = workspace / "enviar_nota_ajuste_produccion.py"
            if not script_path.exists():
                script_path = workspace / "enviar_nota_ajuste_habilitacion.py"
        else:
            script_path = workspace / "enviar_nota_ajuste_habilitacion.py"
        
        if not script_path.exists():
            os.unlink(json_temp_path)
            raise HTTPException(
                status_code=500,
                detail=f"Script de nota de ajuste no encontrado: {script_path}"
            )
        
        # Ejecutar el script de Python
        print(f"🚀 Ejecutando script: {script_path}")
        
        result = subprocess.run(
            [
                sys.executable,
                str(script_path),
                nit,
                json_temp_path
            ],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(workspace)
        )
        
        print(f"📤 Return code: {result.returncode}")
        print(f"📤 stdout (full): {result.stdout if result.stdout else 'N/A'}")
        print(f"📤 stderr (full): {result.stderr if result.stderr else 'N/A'}")
        
        # Limpiar archivo temporal
        try:
            os.unlink(json_temp_path)
        except:
            pass
        
        if result.returncode != 0:
            # Verificar si es Regla 90 (documento ya procesado = éxito)
            stdout_check = (result.stdout or '').upper()
            is_regla_90 = ('REGLA_90' in stdout_check or 'RESULTADO_EXITOSO' in stdout_check 
                          or 'PROCESADO ANTERIORMENTE' in stdout_check)
            
            if is_regla_90:
                # Regla 90 = la DIAN ya aceptó el documento, tratar como éxito
                print(f"⚠️  Regla 90 detectada en returncode!=0, tratando como éxito")
            else:
                # Prefer stdout over stderr — stderr often just has warnings (e.g. RequestsDependencyWarning)
                # stdout has the actual DIAN response or script error details
                error_msg = result.stdout or result.stderr or "Error desconocido al enviar nota de ajuste"
                raise HTTPException(
                    status_code=500,
                    detail=f"Error al enviar Nota de Ajuste: {error_msg[:2000]}"
                )
        
        # Extraer datos de la respuesta
        stdout = result.stdout
        
        # Buscar marcador de éxito del script
        # El script produce: RESULTADO_EXITOSO / CONSECUTIVO: DCSW1 / CUDS: xxxx
        is_success = 'RESULTADO_EXITOSO' in stdout
        
        # Buscar CUDS en la salida (formato: CUDS: [hash de 96 caracteres])
        cuds_match = re.search(r'CUDS[:\s]+([a-f0-9]{96})', stdout, re.IGNORECASE)
        cuds = cuds_match.group(1) if cuds_match else None
        
        # Buscar consecutivo (formato: CONSECUTIVO: DCSW1 o similar)
        consecutivo_match = re.search(r'CONSECUTIVO[:\s]+([A-Z0-9]+)', stdout, re.IGNORECASE)
        consecutivo = consecutivo_match.group(1) if consecutivo_match else None
        
        # Buscar XML file path
        xml_match = re.search(r'XML_FILE[:\s]+([^\s]+)', stdout)
        xml_url = xml_match.group(1) if xml_match else None
        
        # Si encontramos RESULTADO_EXITOSO, es exitoso
        if is_success or '✅' in stdout or 'ACEPTADA' in stdout.upper() or 'AUTORIZADA' in stdout.upper():
            return {
                "status": "success",
                "message": "Nota de Ajuste enviada exitosamente a la DIAN",
                "consecutivo": consecutivo,
                "cuds": cuds,
                "xml_url": xml_url,
                "pdf_url": None
            }
        else:
            # Si no hay indicadores claros de éxito, revisar errores
            if 'ERROR' in stdout.upper() or 'RECHAZAD' in stdout.upper():
                raise HTTPException(
                    status_code=500,
                    detail=f"La DIAN rechazó la Nota de Ajuste: {stdout[:500]}"
                )
            
            # Asumir éxito si no hay errores evidentes
            return {
                "status": "success",
                "message": "Nota de Ajuste procesada",
                "consecutivo": consecutivo,
                "cuds": cuds,
                "xml_url": xml_url,
                "pdf_url": None
            }
        
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail="Timeout al enviar Nota de Ajuste a la DIAN"
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error interno al procesar Nota de Ajuste: {str(e)}"
        )


# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "api_server:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        log_level="info"
    )

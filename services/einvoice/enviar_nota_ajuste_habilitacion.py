#!/usr/bin/env python3
"""
🚀 Script de envío de NOTA DE AJUSTE al Documento Soporte - AMBIENTE HABILITACIÓN
✅ Configurado para anular documentos soporte mediante Nota de Ajuste (Tipo 95)
📋 Según Anexo Técnico DIAN v1.1 - Resolución 000167 (30 DIC 2021) - Sección 8.2

⚙️ PARÁMETROS:
   - sys.argv[1]: NIT de la empresa
   - sys.argv[2]: Ruta al JSON con datos de anulación

📋 ESTRUCTURA DEL JSON:
{
    "documento_original": {
        "id": "SEDS1",              // Prefijo+Número del DS original
        "cuds": "abc123...",         // CUDS del DS original (SHA-384)
        "fecha_emision": "2024-01-15",  // Fecha de emisión del DS original
        "valor_total": 100000.00,    // Valor total del DS original
        "concepto_descripcion": "Bono regalo cliente",
        "concepto_unspsc": "90121502"
    },
    "motivo_anulacion": {
        "codigo": "2",               // 1-5 según tabla 16.2.4
        "descripcion": "Anulación por error en datos"  // Opcional
    },
    "beneficiario": {               // Datos del SNO (vendedor original)
        "nombres": "Juan",
        "apellidos": "Pérez",
        "numero_documento": "12345678",
        "tipo_documento": "13",
        "direccion": "Cra 50 #30-20",
        "ciudad_codigo": "05001",
        "ciudad_nombre": "Medellín",
        "departamento_codigo": "05",
        "departamento_nombre": "Antioquia",
        "email": "juan@email.com",
        "telefono": "3001234567"
    }
}

📌 CÓDIGOS DE RESPUESTA (ResponseCode) - Tabla 16.2.4:
   1 = Devolución parcial de los bienes y/o no aceptación parcial del servicio
   2 = Anulación del documento soporte (ANULACIÓN COMPLETA)
   3 = Rebaja o descuento parcial o total
   4 = Ajuste de precio
   5 = Otros
"""
import sys
import os
import re
import json
from pathlib import Path


def calcular_dv_nit(nit):
    """Calcula el dígito de verificación (DV) de un NIT colombiano."""
    factores = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
    nit_str = str(nit).zfill(15)
    suma = 0
    for i, digito in enumerate(reversed(nit_str)):
        suma += int(digito) * factores[i]
    residuo = suma % 11
    if residuo == 0:
        return '0'
    elif residuo == 1:
        return '1'
    else:
        return str(11 - residuo)


def generar_codigo_postal(codigo_municipio_dane, codigo_departamento=None):
    """Genera un código postal válido de 6 dígitos según la estructura DIAN."""
    if codigo_departamento:
        dept = str(codigo_departamento).zfill(2)
    elif codigo_municipio_dane:
        dept = str(codigo_municipio_dane)[:2].zfill(2)
    else:
        dept = '11'
    
    if codigo_municipio_dane:
        mun_suffix = str(codigo_municipio_dane)[-3:]
        if mun_suffix == '001':
            zona = '00'
        else:
            zona = str(codigo_municipio_dane)[-2:].zfill(2)
    else:
        zona = '00'
    
    distrito = '10'
    codigo_postal = f"{dept}{zona}{distrito}"
    
    if len(codigo_postal) != 6:
        codigo_postal = f"{dept}0010"
    
    return codigo_postal


# Limpiar caché
import subprocess
subprocess.run(['find', '.', '-name', '*.pyc', '-delete'], 
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['find', '.', '-type', 'd', '-name', '__pycache__', '-exec', 'rm', '-rf', '{}', '+'], 
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Obtener NIT de la empresa (OBLIGATORIO)
if len(sys.argv) < 2:
    print('❌ ERROR CRÍTICO: No se proporcionó el NIT de la empresa')
    print('   Uso: python3 enviar_nota_ajuste_habilitacion.py <NIT> <JSON_PATH>')
    sys.exit(1)

EMPRESA_NIT = sys.argv[1]
sys.argv.pop(1)

print(f'🏢 Usando configuración de empresa NIT: {EMPRESA_NIT}')

# Agregar carpeta de la empresa al path
empresa_config_dir = Path(__file__).parent / 'certificados' / EMPRESA_NIT
if not empresa_config_dir.exists():
    print(f'❌ ERROR: No existe la carpeta de configuración para el NIT {EMPRESA_NIT}')
    print(f'   Ruta esperada: {empresa_config_dir}')
    sys.exit(1)

sys.path.insert(0, str(empresa_config_dir))

# IMPORTAR CONFIGURACIONES
import importlib
import config_empresa
import config_dian
importlib.reload(config_empresa)
importlib.reload(config_dian)

print('='*80)
print('📋 NOTA DE AJUSTE AL DOCUMENTO SOPORTE - AMBIENTE HABILITACIÓN')
print('='*80)
print(f'\n🏢 EMPRESA: {config_empresa.EMPRESA_RAZON_SOCIAL}')
print(f'   NIT: {config_empresa.EMPRESA_NIT}-{config_empresa.EMPRESA_DV}')
print('='*80)

from facho.fe import form, form_xml, fe
from facho.fe.client import dian
from datetime import datetime, timezone, timedelta
import zipfile
import base64

# Zona horaria Colombia
COLOMBIA_TZ = timezone(timedelta(hours=-5))

def hora_colombia():
    return datetime.now(COLOMBIA_TZ)

# Configuración empresa
EMPRESA_RAZON_SOCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_NOMBRE_COMERCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_TIPO_ORGANIZACION = '1'
EMPRESA_REGIMEN = config_empresa.EMPRESA_REGIMEN
EMPRESA_RESPONSABILIDADES = config_empresa.EMPRESA_RESPONSABILIDADES
CERTIFICADO_PASSWORD = config_dian.CERTIFICADO_PASSWORD
EMPRESA_CIUDAD_CODIGO = config_empresa.EMPRESA_CIUDAD_CODIGO
EMPRESA_CIUDAD_NOMBRE = config_empresa.EMPRESA_CIUDAD_NOMBRE
EMPRESA_DEPARTAMENTO_CODIGO = config_empresa.EMPRESA_DEPARTAMENTO_CODIGO
EMPRESA_DEPARTAMENTO_NOMBRE = config_empresa.EMPRESA_DEPARTAMENTO_NOMBRE
EMPRESA_PAIS = 'CO'
EMPRESA_DIRECCION = config_empresa.EMPRESA_DIRECCION
EMPRESA_EMAIL = config_empresa.EMPRESA_EMAIL

# Software
ID_SOFTWARE = config_dian.SOFTWARE_ID
PIN_SOFTWARE = config_dian.PIN
CLAVE_TECNICA = config_dian.CLAVE_TECNICA

# Resolución NOTA DE AJUSTE (usa la misma resolución que DS o una específica si existe)
RESOLUCION_NUMERO = getattr(config_dian, 'RESOLUCION_NA_NUMERO', 
                           getattr(config_dian, 'RESOLUCION_DS_NUMERO', ''))
RESOLUCION_FECHA_DESDE = getattr(config_dian, 'RESOLUCION_NA_FECHA_DESDE',
                                getattr(config_dian, 'RESOLUCION_DS_FECHA_DESDE', None))
RESOLUCION_FECHA_HASTA = getattr(config_dian, 'RESOLUCION_NA_FECHA_HASTA',
                                getattr(config_dian, 'RESOLUCION_DS_FECHA_HASTA', None))
RESOLUCION_PREFIJO = getattr(config_dian, 'RESOLUCION_NA_PREFIJO',
                            getattr(config_dian, 'RESOLUCION_DS_PREFIJO', ''))
RESOLUCION_NUMERO_DESDE = getattr(config_dian, 'RESOLUCION_NA_NUMERO_DESDE',
                                 getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', 0))
RESOLUCION_NUMERO_HASTA = getattr(config_dian, 'RESOLUCION_NA_NUMERO_HASTA',
                                 getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', 0))

TEST_SET_ID = getattr(config_dian, 'TEST_SET_ID_NA',
                     getattr(config_dian, 'TEST_SET_ID_DS', ''))

AMBIENTE = fe.AMBIENTE_PRUEBAS

# Consecutivo para Nota de Ajuste (separado del DS)
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_nota_ajuste.txt'

# Cargar datos de anulación desde JSON
DATOS_ANULACION = None
if len(sys.argv) >= 2:
    json_path = sys.argv[1]
    if os.path.exists(json_path):
        print(f'\n📋 Cargando datos de anulación desde: {json_path}')
        with open(json_path, 'r', encoding='utf-8') as f:
            DATOS_ANULACION = json.load(f)
        print('✅ Datos de anulación cargados correctamente')
    else:
        print(f'❌ ERROR: Archivo JSON no encontrado: {json_path}')
        sys.exit(1)
else:
    print('❌ ERROR: Se requiere el archivo JSON con datos de anulación')
    print('   Uso: python3 enviar_nota_ajuste_habilitacion.py <NIT> <JSON_PATH>')
    sys.exit(1)


def extensions(inv):
    """Genera las extensiones XML requeridas por la DIAN para Nota de Ajuste"""
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        ID_SOFTWARE, 
        PIN_SOFTWARE, 
        inv.invoice_ident
    )
    
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    # CUDS para Nota de Ajuste (misma fórmula que DS)
    cuds = fe.DianXMLExtensionCUDS(
        inv, 
        PIN_SOFTWARE,
        AMBIENTE
    )
    
    software_provider = fe.DianXMLExtensionSoftwareProvider(
        config_empresa.EMPRESA_NIT,
        config_empresa.EMPRESA_DV,
        ID_SOFTWARE
    )
    
    inv_authorization = fe.DianXMLExtensionInvoiceAuthorization(
        RESOLUCION_NUMERO,
        RESOLUCION_FECHA_DESDE,
        RESOLUCION_FECHA_HASTA,
        RESOLUCION_PREFIJO,
        RESOLUCION_NUMERO_DESDE,
        RESOLUCION_NUMERO_HASTA
    )
    
    return [security_code, authorization_provider, cuds, software_provider, inv_authorization]


def crear_nota_ajuste():
    """
    Crea una Nota de Ajuste al Documento Soporte para anulación.
    
    La Nota de Ajuste (CreditNote tipo 95) referencia al DS original
    y lo anula completamente o parcialmente según el código de respuesta.
    """
    # Crear documento como Invoice (la clase XML lo convertirá a CreditNote)
    inv = form.Invoice('01')
    
    ahora_colombia = hora_colombia()
    inv.set_period(ahora_colombia, ahora_colombia)
    inv.set_issue(ahora_colombia)
    inv.set_operation_type('10')  # Estándar (Residente)
    
    # Datos del documento original
    doc_original = DATOS_ANULACION['documento_original']
    motivo = DATOS_ANULACION.get('motivo_anulacion', {})
    beneficiario = DATOS_ANULACION['beneficiario']
    
    # ========================================================================
    # DISCREPANCY RESPONSE - Motivo de la anulación
    # ========================================================================
    inv.discrepancy_response = {
        'reference_id': doc_original['id'],  # ID del DS original
        'response_code': motivo.get('codigo', '2'),  # 2 = Anulación
        'description': motivo.get('descripcion', 
            'Anulación del documento soporte en adquisiciones efectuadas a sujetos no obligados a expedir factura de venta o documento equivalente')
    }
    
    # ========================================================================
    # BILLING REFERENCE - Referencia al documento original
    # ========================================================================
    inv.billing_reference = {
        'id': doc_original['id'],  # Prefijo+Número del DS
        'uuid': doc_original['cuds'],  # CUDS del DS original
        'issue_date': doc_original['fecha_emision']  # Fecha del DS
    }
    
    print(f'\n📄 DOCUMENTO SOPORTE A ANULAR:')
    print(f'   ID Original: {doc_original["id"]}')
    print(f'   CUDS: {doc_original["cuds"][:30]}...')
    print(f'   Fecha Emisión: {doc_original["fecha_emision"]}')
    print(f'   Valor: ${doc_original["valor_total"]:,.2f}')
    print(f'\n📋 MOTIVO ANULACIÓN:')
    print(f'   Código: {motivo.get("codigo", "2")}')
    print(f'   Descripción: {motivo.get("descripcion", "Anulación del documento soporte")}')
    
    # ========================================================================
    # SUPPLIER (SNO) - Beneficiario original del bono
    # ========================================================================
    numero_doc = beneficiario.get('numero_documento', '0')
    dv_calculado = calcular_dv_nit(numero_doc)
    
    supplier = form.Party(
        legal_name=f"{beneficiario.get('nombres', '')} {beneficiario.get('apellidos', '')}".strip(),
        name=f"{beneficiario.get('nombres', '')} {beneficiario.get('apellidos', '')}".strip(),
        ident=form.PartyIdentification(
            numero_doc,
            dv_calculado,
            '31'  # NIT según DSAJ25a
        ),
        responsability_code=form.Responsability(['R-99-PN']),
        responsability_regime_code='49',
        organization_code='2',  # Persona Natural
        email=beneficiario.get('email', ''),
        phone=beneficiario.get('telefono', ''),
        tax_scheme=form.TaxScheme('ZZ'),
        address=form.Address(
            name=beneficiario.get('direccion', 'N/A'),
            street=beneficiario.get('direccion', 'N/A'),
            city=form.City(
                beneficiario.get('ciudad_codigo', '05001'),
                beneficiario.get('ciudad_nombre', 'Medellín')
            ),
            country=form.Country(beneficiario.get('pais', 'CO'), 'Colombia'),
            countrysubentity=form.CountrySubentity(
                beneficiario.get('departamento_codigo', '05'),
                beneficiario.get('departamento_nombre', 'Antioquia')
            ),
            postal_code=beneficiario.get('codigo_postal', 
                generar_codigo_postal(
                    beneficiario.get('ciudad_codigo', '05001'),
                    beneficiario.get('departamento_codigo', '05')
                ))
        )
    )
    inv.set_supplier(supplier)
    
    print(f'\n👤 BENEFICIARIO (SNO):')
    print(f'   {beneficiario.get("nombres")} {beneficiario.get("apellidos")}')
    print(f'   Documento: {numero_doc} (NIT: {numero_doc}-{dv_calculado})')
    
    # ========================================================================
    # CUSTOMER (ABS) - Empresa (nosotros)
    # ========================================================================
    customer = form.Party(
        legal_name=EMPRESA_RAZON_SOCIAL,
        name=EMPRESA_NOMBRE_COMERCIAL,
        ident=form.PartyIdentification(
            config_empresa.EMPRESA_NIT,
            config_empresa.EMPRESA_DV,
            '31'
        ),
        responsability_code=form.Responsability(EMPRESA_RESPONSABILIDADES),
        responsability_regime_code=EMPRESA_REGIMEN,
        organization_code=EMPRESA_TIPO_ORGANIZACION,
        email=EMPRESA_EMAIL,
        phone=getattr(config_empresa, 'EMPRESA_TELEFONO', '3001234567'),
        address=form.Address(
            name=EMPRESA_DIRECCION,
            street=EMPRESA_DIRECCION,
            city=form.City(EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE),
            country=form.Country(EMPRESA_PAIS, 'Colombia'),
            countrysubentity=form.CountrySubentity(
                EMPRESA_DEPARTAMENTO_CODIGO,
                EMPRESA_DEPARTAMENTO_NOMBRE
            ),
            postal_code=getattr(config_empresa, 'EMPRESA_CODIGO_POSTAL', 
                generar_codigo_postal(EMPRESA_CIUDAD_CODIGO, EMPRESA_DEPARTAMENTO_CODIGO))
        )
    )
    inv.set_customer(customer)
    
    # ========================================================================
    # MEDIO DE PAGO
    # ========================================================================
    inv.set_payment_mean(form.PaymentMean(
        id='1',  # Contado
        code='10',  # Efectivo
        due_at=ahora_colombia,
        payment_id='1'  # Identificador del pago
    ))
    
    # ========================================================================
    # LÍNEA DEL DOCUMENTO (valor a anular)
    # ========================================================================
    valor_total = doc_original['valor_total']
    
    # Para bienes/servicios EXCLUIDOS de IVA (bonos/premios): usar TaxTotalOmit
    # Regla DSAX01: "Este grupo NO debe ser informado para ítems excluidos"
    # Esto aplica tanto al Documento Soporte como a su Nota de Ajuste
    
    codigo_unspsc = doc_original.get('concepto_unspsc', '90121502')
    concepto_descripcion = doc_original.get('concepto_descripcion', 'Anulación documento soporte')
    
    line = form.InvoiceLine(
        quantity=form.Quantity(1, '94'),  # Unidad
        description=concepto_descripcion,
        item=form.UNSPSCItem(codigo_unspsc, concepto_descripcion),  # UNSPSCItem(id_, description)
        price=form.Price(
            amount=form.Amount(valor_total),
            type_code='01',  # Precio comercial
            type='x'
        ),
        # Para bienes/servicios EXCLUIDOS: NO enviar TaxTotal (usar TaxTotalOmit)
        tax=form.TaxTotalOmit()  # Excluido de IVA - no envía elemento TaxTotal en XML
    )
    
    inv.add_invoice_line(line)
    
    # Calcular totales
    inv.calculate()
    
    return inv


def document_xml():
    """Retorna la clase para generar el XML de Nota de Ajuste"""
    return form_xml.DIANSupportDocumentCreditNoteXML


# ============================================================================
# MAIN: Envío a DIAN
# ============================================================================
if __name__ == '__main__':
    def obtener_consecutivo(num_especifico=None):
        if num_especifico:
            num = int(num_especifico)
            if RESOLUCION_NUMERO_DESDE <= num <= RESOLUCION_NUMERO_HASTA:
                return num
            print(f'⚠️  Número {num} fuera del rango autorizado')
            return RESOLUCION_NUMERO_DESDE
        
        if os.path.exists(CONSECUTIVO_FILE):
            with open(CONSECUTIVO_FILE, 'r') as f:
                ultimo_usado = int(f.read().strip())
                if ultimo_usado < RESOLUCION_NUMERO_DESDE:
                    return RESOLUCION_NUMERO_DESDE
                elif ultimo_usado > RESOLUCION_NUMERO_HASTA:
                    return RESOLUCION_NUMERO_DESDE
                else:
                    siguiente = ultimo_usado + 1
                    if siguiente > RESOLUCION_NUMERO_HASTA:
                        raise ValueError(f'Se ha excedido el rango de consecutivos')
                    return siguiente
        return RESOLUCION_NUMERO_DESDE
    
    def guardar_consecutivo(num):
        with open(CONSECUTIVO_FILE, 'w') as f:
            f.write(str(num))
    
    num_doc = obtener_consecutivo()
    print(f'ℹ️  Usando consecutivo: {num_doc}')
    
    MAX_INTENTOS = getattr(config_dian, 'MAX_INTENTOS_ENVIO', 20)
    intento = 0
    doc_exitoso = False
    
    while intento < MAX_INTENTOS:
        intento += 1
        if intento > 1:
            print(f"\n🔄 Reintento {intento}/{MAX_INTENTOS} con consecutivo: {num_doc}")
        
        print("="*80)
        print(f"📋 ENVIANDO NOTA DE AJUSTE {RESOLUCION_PREFIJO}{num_doc} A DIAN HABILITACIÓN")
        print("="*80)
        
        # Generar documento
        inv = crear_nota_ajuste()
        inv.set_ident(f'{RESOLUCION_PREFIJO}{num_doc}')
        inv.calculate()
        
        print(f"\n✅ Nota de Ajuste generada: {inv.invoice_ident}")
        print(f"   Documento Original: {inv.billing_reference['id']}")
        print(f"   Motivo: Código {inv.discrepancy_response['response_code']}")
        print(f"   Total a Anular: ${inv.invoice_legal_monetary_total.payable_amount.float():,.2f}")
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        xml_file = f'/tmp/na_{inv.invoice_ident}_firmada.xml'
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f"✅ XML firmado: {xml_file}")
        
        # Crear ZIP
        zip_file = f'/tmp/na_{inv.invoice_ident}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'na_{inv.invoice_ident}.xml')
        print(f"✅ ZIP creado: {zip_file}")
        
        # Enviar a DIAN
        print("\n📤 Enviando a DIAN Habilitación...")
        print("="*80)
        
        key_pem_path = f'certificados/{EMPRESA_NIT}/llave_firma.pem'
        cert_pem_path = f'certificados/{EMPRESA_NIT}/certificado_firma.pem'
        client = dian.DianSignatureClient(key_pem_path, cert_pem_path, password=None)
        
        with open(zip_file, 'rb') as f:
            zip_content = f.read()
        
        zip_base64 = base64.b64encode(zip_content).decode('utf-8')
        
        try:
            response = client.request(dian.Habilitacion.SendBillSync(
                f'na_{inv.invoice_ident}.zip', zip_base64))
            
            print("\n📨 RESPUESTA DE LA DIAN:")
            print("="*80)
            
            for attr in dir(response):
                if not attr.startswith('_'):
                    value = getattr(response, attr, None)
                    if value is not None and not callable(value):
                        print(f"{attr}: {value}")
            
            print("\n" + "="*80)
            
            if hasattr(response, 'IsValid'):
                print(f"\n{'✅' if response.IsValid else '❌'} IsValid: {response.IsValid}")
            
            if hasattr(response, 'StatusCode'):
                print(f"📊 StatusCode: {response.StatusCode}")
                
            if hasattr(response, 'StatusDescription'):
                print(f"📝 StatusDescription: {response.StatusDescription}")
            
            # Procesar respuesta
            if hasattr(response, 'IsValid') and not response.IsValid:
                print(f"\n❌ NOTA DE AJUSTE RECHAZADA POR LA DIAN")
                
                if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                    errors = response.ErrorMessage
                    if hasattr(errors, 'string'):
                        error_list = errors.string if isinstance(errors.string, list) else [errors.string]
                    else:
                        error_list = [errors] if isinstance(errors, str) else []
                    
                    if error_list:
                        es_duplicado = any(
                            bool(re.search(r'regla[:)]?\s*90|procesado\s+anteriormente',
                                          str(error), re.IGNORECASE))
                            for error in error_list
                        )
                        
                        if es_duplicado:
                            print(f"\n⚠️  Consecutivo {num_doc} ya procesado (Regla 90)")
                            print(f"   La DIAN YA aceptó este documento previamente.")
                            doc_exitoso = True
                            guardar_consecutivo(num_doc)
                            # Imprimir formato parseable de éxito
                            print('\n' + '='*80)
                            print('RESULTADO_EXITOSO')
                            print(f'CONSECUTIVO: {num_doc}')
                            print(f'REGLA_90: true')
                            print('='*80)
                            break
                        else:
                            print(f"\n❌ ERRORES DE VALIDACIÓN:")
                            for i, error in enumerate(error_list, 1):
                                print(f"{i:3d}. {error}")
                            guardar_consecutivo(num_doc)
                            break
                break
            
            # Éxito
            if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                errors = response.ErrorMessage
                if hasattr(errors, 'string'):
                    error_list = errors.string if isinstance(errors.string, list) else [errors.string]
                else:
                    error_list = []
                
                if error_list:
                    es_duplicado = any(
                        bool(re.search(r'regla[:)]?\s*90', str(error), re.IGNORECASE))
                        for error in error_list
                    )
                    
                    if es_duplicado:
                        guardar_consecutivo(num_doc)
                        num_doc += 1
                        continue
                    else:
                        print(f"\n❌ ERRORES:")
                        for i, error in enumerate(error_list, 1):
                            print(f"{i:3d}. {error}")
                        guardar_consecutivo(num_doc)
                        break
                else:
                    print("\n✅ ¡NOTA DE AJUSTE ACEPTADA!")
                    doc_exitoso = True
                    guardar_consecutivo(num_doc)
                    break
            else:
                print("\n✅ ¡NOTA DE AJUSTE ACEPTADA!")
                doc_exitoso = True
                if hasattr(response, 'IsValid') and response.IsValid:
                    guardar_consecutivo(num_doc)
                break
                
        except Exception as e:
            print("\n" + "="*80)
            print("❌ ERROR EN LA COMUNICACIÓN CON DIAN")
            print("="*80)
            print(f"Tipo de error: {type(e).__name__}")
            print(f"Mensaje: {str(e)}")
            import traceback
            traceback.print_exc()
            guardar_consecutivo(num_doc)
            break
        
        finally:
            print("\n📁 Archivos guardados:")
            print(f"   XML: {xml_file}")
            print(f"   ZIP: {zip_file}")
    
    if intento >= MAX_INTENTOS and not doc_exitoso:
        print(f"\n⚠️  Se alcanzó el máximo de intentos ({MAX_INTENTOS})")
    
    # Limpiar archivo JSON temporal
    if len(sys.argv) >= 2:
        json_path = sys.argv[1]
        if os.path.exists(json_path) and '/tmp/' in json_path:
            try:
                os.remove(json_path)
                print(f"\n🗑️  Archivo temporal eliminado: {json_path}")
            except Exception:
                pass
    
    # Salir con código de éxito/error
    sys.exit(0 if doc_exitoso else 1)

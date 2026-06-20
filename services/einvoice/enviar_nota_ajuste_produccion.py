#!/usr/bin/env python3
"""
🚀 Script de envío de NOTA DE AJUSTE al Documento Soporte - AMBIENTE PRODUCCIÓN
✅ Configurado para anular documentos soporte mediante Nota de Ajuste (Tipo 95)
📋 Según Anexo Técnico DIAN v1.1 - Resolución 000167 (30 DIC 2021) - Sección 8.2
📋 Lee configuración desde certificados/{NIT}/config_empresa.py y config_dian_produccion.py

⚙️ DIFERENCIAS CON HABILITACIÓN:
   1. URL: vpfe.dian.gov.co (NO vpfe-hab)
   2. Método: dian.SendBillSync (NO dian.Habilitacion.SendBillSync)
   3. NO requiere TestSetId
   4. ProfileExecutionID = 1 (Producción según DIAN)
   5. Archivo config: config_dian_produccion.py

⚙️ PARÁMETROS:
   - sys.argv[1]: NIT de la empresa
   - sys.argv[2]: Ruta al JSON con datos de anulación

📋 ESTRUCTURA DEL JSON:
{
    "documento_original": {
        "id": "DCSW14",              // Prefijo+Número del DS original
        "cuds": "abc123...",         // CUDS del DS original (SHA-384)
        "fecha_emision": "2024-01-15",  // Fecha de emisión del DS original
        "valor_total": 100000.00,    // Valor total del DS original
        "concepto_descripcion": "Premios e incentivos",
        "concepto_unspsc": "90121502"
    },
    "motivo_anulacion": {
        "codigo": "2",               // 1-5 según tabla 16.2.4
        "descripcion": "Anulación por error en datos"
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


# ============================================================================
# CONFIGURACIÓN DE EMPRESA (desde argumentos)
# ============================================================================

# Obtener NIT de la empresa (OBLIGATORIO)
if len(sys.argv) < 2:
    print('❌ ERROR CRÍTICO: No se proporcionó el NIT de la empresa')
    print('   Uso: python3 enviar_nota_ajuste_produccion.py <NIT> <JSON_PATH>')
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

# PRODUCCIÓN: Usa config_dian_produccion.py
try:
    import config_dian_produccion as config_dian
    importlib.reload(config_dian)
    print('✅ Usando configuración de PRODUCCIÓN (config_dian_produccion.py)')
except ImportError:
    print('❌ ERROR: No existe config_dian_produccion.py en la carpeta del NIT')
    print(f'   Ruta esperada: {empresa_config_dir}/config_dian_produccion.py')
    sys.exit(1)

importlib.reload(config_empresa)

print('='*80)
print('📋 NOTA DE AJUSTE AL DOCUMENTO SOPORTE - AMBIENTE PRODUCCIÓN')
print('='*80)
print(f'\n🏢 EMPRESA: {config_empresa.EMPRESA_RAZON_SOCIAL}')
print(f'   NIT: {config_empresa.EMPRESA_NIT}-{config_empresa.EMPRESA_DV}')
print('='*80)

from facho.fe import form, form_xml, fe
from facho.fe.client import dian
from datetime import datetime, timezone, timedelta, date
import zipfile
import base64

# Zona horaria Colombia
COLOMBIA_TZ = timezone(timedelta(hours=-5))

def hora_colombia():
    return datetime.now(COLOMBIA_TZ)


# ============================================================================
# CONFIGURACIÓN EMPRESA Y SOFTWARE
# ============================================================================
EMPRESA_RAZON_SOCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_NOMBRE_COMERCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_DV = config_empresa.EMPRESA_DV
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

# Resolución NOTA DE AJUSTE (usa la misma resolución que DS)
# La Nota de Ajuste usa la misma resolución del DS
RESOLUCION_NUMERO = getattr(config_dian, 'RESOLUCION_DS_NUMERO', '')
RESOLUCION_FECHA_DESDE = getattr(config_dian, 'RESOLUCION_DS_FECHA_DESDE', None)
RESOLUCION_FECHA_HASTA = getattr(config_dian, 'RESOLUCION_DS_FECHA_HASTA', None)
RESOLUCION_PREFIJO = getattr(config_dian, 'RESOLUCION_DS_PREFIJO', '')
RESOLUCION_NUMERO_DESDE = getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', 0)
RESOLUCION_NUMERO_HASTA = getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', 0)

# ============================================================================
# AMBIENTE PRODUCCIÓN
# ============================================================================
AMBIENTE = fe.AMBIENTE_PRODUCCION  # ProfileExecutionID = 1 (Producción)

# Archivo de consecutivos específico para Nota de Ajuste producción
# NOTA: Si el backend proporciona consecutivo_nota_credito, se usa ese en lugar del archivo
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_nota_ajuste_prod.txt'

# ============================================================================
# CARGAR DATOS DE ANULACIÓN DESDE JSON
# ============================================================================
JSON_PATH = None
DATOS_ANULACION = None

if len(sys.argv) >= 2:
    JSON_PATH = sys.argv[1]
    if os.path.exists(JSON_PATH):
        print(f'\n📋 Cargando datos de anulación desde: {JSON_PATH}')
        with open(JSON_PATH, 'r', encoding='utf-8') as f:
            DATOS_ANULACION = json.load(f)
        print('✅ Datos de anulación cargados correctamente')
    else:
        print(f'❌ ERROR: No existe el archivo JSON: {JSON_PATH}')
        sys.exit(1)
else:
    print('❌ ERROR: Debe proporcionar la ruta al archivo JSON con los datos de anulación')
    print('   Uso: python3 enviar_nota_ajuste_produccion.py <NIT> <JSON_PATH>')
    sys.exit(1)

# Extraer datos
doc_original = DATOS_ANULACION.get('documento_original', {})
motivo_anulacion = DATOS_ANULACION.get('motivo_anulacion', {})
beneficiario = DATOS_ANULACION.get('beneficiario', {})

print('\n📋 DATOS DEL DOCUMENTO ORIGINAL:')
print(f'   ID: {doc_original.get("id")}')
print(f'   CUDS: {doc_original.get("cuds", "")[:40]}...')
print(f'   Fecha: {doc_original.get("fecha_emision")}')
print(f'   Valor: ${doc_original.get("valor_total", 0):,.2f}')

print('\n📋 MOTIVO DE ANULACIÓN:')
print(f'   Código: {motivo_anulacion.get("codigo", "2")}')
print(f'   Descripción: {motivo_anulacion.get("descripcion", "Anulación")}')

print('\n📋 BENEFICIARIO/SNO:')
print(f'   Nombre: {beneficiario.get("nombres", "")} {beneficiario.get("apellidos", "")}')
print(f'   Documento: {beneficiario.get("numero_documento")}')

print('\n🌍 AMBIENTE:')
print(f'   Ambiente: 🔴 PRODUCCIÓN (Documentos REALES)')
print(f'   URL: https://vpfe.dian.gov.co/WcfDianCustomerServices.svc')
print('='*80 + '\n')


# ============================================================================
# FUNCIÓN: EXTENSIONES DIAN PARA NOTA DE AJUSTE
# ============================================================================
def extensions(inv):
    """
    Genera las extensiones XML requeridas por la DIAN para Nota de Ajuste - PRODUCCIÓN
    """
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        ID_SOFTWARE, 
        PIN_SOFTWARE, 
        inv.invoice_ident
    )
    
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    # CUDS para Nota de Ajuste - Usa Software-PIN (no Clave Técnica)
    cuds = fe.DianXMLExtensionCUDS(
        inv, 
        PIN_SOFTWARE,
        AMBIENTE  # AMBIENTE_PRODUCCION
    )
    
    software_provider = fe.DianXMLExtensionSoftwareProvider(
        EMPRESA_NIT,
        EMPRESA_DV,
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


# ============================================================================
# FUNCIÓN: CREAR NOTA DE AJUSTE
# ============================================================================
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
    # Determinar si es no residente para CustomizationID
    es_no_residente = beneficiario.get('es_residente') == False
    if es_no_residente:
        inv.set_operation_type('11')  # No Residente
        print(f'📋 CustomizationID=11 → NO RESIDENTE (Nota de Ajuste)')
    else:
        inv.set_operation_type('10')  # Residente
        print(f'📋 CustomizationID=10 → RESIDENTE (Nota de Ajuste)')
    
    # ========================================================================
    # REFERENCIA AL DOCUMENTO ORIGINAL (BillingReference)
    # ========================================================================
    # Según Anexo Técnico 8.2.1 NSBD: cac:BillingReference/cac:InvoiceDocumentReference
    ds_id = doc_original.get('id', '')
    ds_cuds = doc_original.get('cuds', '')
    ds_fecha_str = doc_original.get('fecha_emision', '')
    
    # Parsear fecha del DS original (manejar múltiples formatos)
    if isinstance(ds_fecha_str, str):
        # Intentar varios formatos de fecha
        for fmt in ['%Y-%m-%d', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S']:
            try:
                ds_fecha = datetime.strptime(ds_fecha_str.split('.')[0].replace('Z', ''), fmt.replace('.%fZ', '').replace('Z', '')).date()
                break
            except ValueError:
                continue
        else:
            # Si ningún formato funciona, usar solo los primeros 10 caracteres (YYYY-MM-DD)
            ds_fecha = datetime.strptime(ds_fecha_str[:10], '%Y-%m-%d').date()
    else:
        ds_fecha = ds_fecha_str
    
    # Crear referencia al documento original
    billing_ref = form.BillingReference(
        ident=ds_id,
        uuid=ds_cuds,
        date=ds_fecha
    )
    inv.set_billing_reference(billing_ref)
    
    # ========================================================================
    # DISCREPANCY RESPONSE (Motivo de la Nota de Ajuste)
    # ========================================================================
    # Según Anexo Técnico 8.2.1 NSBC: cac:DiscrepancyResponse
    response_code = motivo_anulacion.get('codigo', '2')  # Default: Anulación completa
    response_description = motivo_anulacion.get('descripcion', 'Anulación del documento soporte')
    
    # Agregar DiscrepancyResponse al Invoice como diccionario
    # El form_xml.DIANSupportDocumentCreditNoteXML lo convertirá al XML correcto
    inv.discrepancy_response = {
        'reference_id': ds_id,
        'response_code': response_code,
        'description': response_description
    }
    
    # ========================================================================
    # ADQUIRENTE (HSQ - quien recibió el DS original)
    # ========================================================================
    empresa_codigo_postal = generar_codigo_postal(
        EMPRESA_CIUDAD_CODIGO,
        EMPRESA_DEPARTAMENTO_CODIGO
    )
    
    # Asegurar que responsabilidades sea lista
    empresa_responsabilidades = EMPRESA_RESPONSABILIDADES
    if isinstance(empresa_responsabilidades, str):
        empresa_responsabilidades = [empresa_responsabilidades]
    
    # NSAK20: Debe informarse el nombre/razón social del adquiriente (RegistrationName)
    inv.set_customer(form.Party(
        name=EMPRESA_RAZON_SOCIAL,
        legal_name=EMPRESA_RAZON_SOCIAL,  # NSAK20: RegistrationName - OBLIGATORIO
        ident=form.PartyIdentification(EMPRESA_NIT, EMPRESA_DV, '31'),
        responsability_code=form.Responsability(empresa_responsabilidades),
        responsability_regime_code=EMPRESA_REGIMEN,
        organization_code=EMPRESA_TIPO_ORGANIZACION,
        tax_scheme=form.TaxScheme('01'),
        email=EMPRESA_EMAIL,
        address=form.Address(
            name=EMPRESA_DIRECCION,
            street=EMPRESA_DIRECCION,
            city=form.City(EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE),
            country=form.Country('CO', 'Colombia'),
            countrysubentity=form.CountrySubentity(EMPRESA_DEPARTAMENTO_CODIGO, EMPRESA_DEPARTAMENTO_NOMBRE),
            postal_code=empresa_codigo_postal
        )
    ))
    
    # ========================================================================
    # PROVEEDOR/SNO (Beneficiario original del DS)
    # ========================================================================
    beneficiario_numero = beneficiario.get('numero_documento', '')
    beneficiario_nombres = beneficiario.get('nombres', '')
    beneficiario_apellidos = beneficiario.get('apellidos', '')
    beneficiario_nombre_completo = f"{beneficiario_nombres} {beneficiario_apellidos}".strip()
    beneficiario_email = beneficiario.get('email', 'no-email@example.com')
    
    if es_no_residente:
        # ================================================================
        # NO RESIDENTE: Sin DV, tipo doc real, dirección extranjera
        # ================================================================
        tipo_documento_fiscal = beneficiario.get('tipo_documento', '41')
        dv_no_residente = ''  # Sin DV para no residentes
        
        print(f"\n📋 DATOS DEL VENDEDOR SNO (NO RESIDENTE - Nota de Ajuste):")
        print(f"   Número documento: {beneficiario_numero}")
        print(f"   Tipo documento fiscal: {tipo_documento_fiscal}")
        print(f"   Sin DV (no residente)")
        
        inv.set_supplier(form.Party(
            name=beneficiario_nombre_completo,
            legal_name=beneficiario_nombre_completo,
            ident=form.PartyIdentification(beneficiario_numero, dv_no_residente, tipo_documento_fiscal),
            responsability_code=form.Responsability(['R-99-PN']),
            responsability_regime_code='49',
            organization_code='2',
            tax_scheme=form.TaxScheme('ZZ'),
            email=beneficiario_email,
            address=form.ForeignAddress(
                city_name=beneficiario.get('ciudad_nombre', ''),
                country_code=beneficiario.get('pais', 'US'),
                country_name=beneficiario.get('pais_nombre', ''),
                address_line=beneficiario.get('direccion', ''),
                state_province=beneficiario.get('estado_provincia', '')
            )
        ))
    else:
        # ================================================================
        # RESIDENTE: DV calculado, NIT (31), dirección colombiana
        # ================================================================
        beneficiario_dv = calcular_dv_nit(beneficiario_numero)
        beneficiario_ciudad = beneficiario.get('ciudad_codigo', '05001')
        beneficiario_ciudad_nombre = beneficiario.get('ciudad_nombre', 'Medellín')
        beneficiario_departamento = beneficiario.get('departamento_codigo', '05')
        beneficiario_departamento_nombre = beneficiario.get('departamento_nombre', 'Antioquia')
        beneficiario_direccion = beneficiario.get('direccion', 'Sin dirección')
        
        beneficiario_codigo_postal = beneficiario.get('codigo_postal')
        if not beneficiario_codigo_postal:
            beneficiario_codigo_postal = generar_codigo_postal(
                beneficiario_ciudad,
                beneficiario_departamento
            )
        
        print(f"\n📋 DATOS DEL VENDEDOR SNO (RESIDENTE - Nota de Ajuste):")
        print(f"   Número documento: {beneficiario_numero}")
        print(f"   DV calculado: {beneficiario_dv}")
        
        inv.set_supplier(form.Party(
            name=beneficiario_nombre_completo,
            legal_name=beneficiario_nombre_completo,
            ident=form.PartyIdentification(beneficiario_numero, beneficiario_dv, '31'),
            responsability_code=form.Responsability(['R-99-PN']),
            responsability_regime_code='49',
            organization_code='2',
            tax_scheme=form.TaxScheme('ZZ'),
            email=beneficiario_email,
            address=form.Address(
                name=beneficiario_direccion,
                street=beneficiario_direccion,
                city=form.City(beneficiario_ciudad, beneficiario_ciudad_nombre),
                country=form.Country('CO', 'Colombia'),
                countrysubentity=form.CountrySubentity(beneficiario_departamento, beneficiario_departamento_nombre),
                postal_code=beneficiario_codigo_postal
            )
        ))
    
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
    valor_total = doc_original.get('valor_total', 0)
    
    # Para bienes/servicios EXCLUIDOS de IVA (bonos/premios): usar TaxTotalOmit
    # Regla DSAX01: "Este grupo NO debe ser informado para ítems excluidos"
    # Esto aplica tanto al Documento Soporte como a su Nota de Ajuste
    
    codigo_unspsc = doc_original.get('concepto_unspsc', '90121502')
    concepto_descripcion = doc_original.get('concepto_descripcion', 'Anulación documento soporte')
    
    # ========================================================================
    # RETENCIÓN EN LA FUENTE (WithholdingTaxTotal)
    # ========================================================================
    # IMPORTANTE: Según el esquema UBL del Anexo Técnico DIAN, la Nota de Ajuste
    # al Documento Soporte (CreditNote tipo 95) NO incluye el elemento 
    # WithholdingTaxTotal. El esquema CreditNote NO lo soporta (Error ZB01).
    # 
    # La retención se reporta SOLO en el Documento Soporte original (Invoice).
    # La Nota de Ajuste simplemente referencia el DS original y ajusta valores.
    # ========================================================================
    tiene_retencion = doc_original.get('tiene_retencion', False)
    if tiene_retencion:
        porcentaje_retencion = doc_original.get('porcentaje_retencion', 20.0)
        valor_retencion = doc_original.get('valor_retencion', valor_total * 0.20)
        base_gravable = doc_original.get('base_gravable', valor_total)
        
        print(f'\n💰 RETENCIÓN EN LA FUENTE (Nota de Ajuste):')
        print(f'   Documento original tenía retención: SÍ')
        print(f'   Base Gravable: ${base_gravable:,.2f}')
        print(f'   Tarifa: {porcentaje_retencion}%')
        print(f'   Valor Retención: ${valor_retencion:,.2f}')
        print(f'   ⚠️  NOTA: El esquema CreditNote NO permite WithholdingTaxTotal.')
        print(f'   ⚠️  La retención fue reportada en el DS original, NO se repite aquí.')
    else:
        print(f'\n💰 RETENCIÓN EN LA FUENTE (Nota de Ajuste):')
        print(f'   Documento original tenía retención: NO')
    
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
# FUNCIÓN: OBTENER SIGUIENTE CONSECUTIVO
# ============================================================================
def obtener_siguiente_consecutivo():
    """
    Obtiene el siguiente número de consecutivo para Nota de Ajuste.
    Usa un archivo separado del de DS para evitar conflictos.
    """
    consecutivo_path = Path(__file__).parent / CONSECUTIVO_FILE
    
    # Intentar leer el último consecutivo
    ultimo = 0
    if consecutivo_path.exists():
        try:
            with open(consecutivo_path, 'r') as f:
                contenido = f.read().strip()
                if contenido:
                    ultimo = int(contenido)
        except (ValueError, IOError):
            ultimo = 0
    
    # Calcular siguiente
    siguiente = ultimo + 1
    
    # Validar que esté dentro del rango de la resolución
    if siguiente < RESOLUCION_NUMERO_DESDE:
        siguiente = RESOLUCION_NUMERO_DESDE
    elif siguiente > RESOLUCION_NUMERO_HASTA:
        print(f'❌ ERROR: Se agotó el rango de consecutivos ({RESOLUCION_NUMERO_DESDE}-{RESOLUCION_NUMERO_HASTA})')
        sys.exit(1)
    
    return siguiente


def guardar_consecutivo(numero):
    """Guarda el último consecutivo usado."""
    consecutivo_path = Path(__file__).parent / CONSECUTIVO_FILE
    consecutivo_path.parent.mkdir(parents=True, exist_ok=True)
    with open(consecutivo_path, 'w') as f:
        f.write(str(numero))


# ============================================================================
# MAIN: Envío a DIAN PRODUCCIÓN
# ============================================================================
if __name__ == '__main__':
    try:
        # Crear Nota de Ajuste
        inv = crear_nota_ajuste()
        
        # Verificar si el backend proporcionó el consecutivo
        consecutivo_backend = DATOS_ANULACION.get('consecutivo_nota_credito') if DATOS_ANULACION else None
        ds_original_ref = DATOS_ANULACION.get('ds_original_ref', '') if DATOS_ANULACION else ''
        
        if consecutivo_backend:
            # Usar el consecutivo proporcionado por el backend (gestión centralizada por empresa)
            consecutivo = consecutivo_backend
            num_doc = None  # No aplica, se gestiona por DB
            print(f'\n📋 Usando consecutivo del backend: {consecutivo}')
            if ds_original_ref:
                print(f'📌 Afecta DS original: {ds_original_ref}')
        else:
            # Fallback: generar consecutivo desde archivo (modo legacy)
            num_doc = obtener_siguiente_consecutivo()
            consecutivo = f'{RESOLUCION_PREFIJO}{num_doc}'
            print(f'\n📋 Consecutivo generado (legacy): {consecutivo}')
        
        print(f'\n📋 ENVIANDO NOTA DE AJUSTE {consecutivo} A DIAN PRODUCCIÓN')
        print('='*80)
        
        # Establecer identificador
        inv.set_ident(consecutivo)
        
        # Mostrar información del documento
        print(f'\n📄 DATOS DEL DOCUMENTO:')
        print(f'   Consecutivo: {consecutivo}')
        print(f'   Tipo: Nota de Ajuste (CreditNote tipo 95)')
        print(f'   DS Original: {doc_original.get("id")}')
        print(f'   CUDS Original: {doc_original.get("cuds", "")[:40]}...')
        print(f'   Motivo: {motivo_anulacion.get("codigo")} - {motivo_anulacion.get("descripcion")}')
        print(f'   Valor: ${doc_original.get("valor_total", 0):,.2f}')
        print(f'   Ambiente: 🔴 PRODUCCIÓN (ProfileExecutionID=1)')
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        # Firmar XML
        xml_file = f'/tmp/na_prod_{consecutivo}_firmado.xml'
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f'✅ XML firmado: {xml_file}')
        
        # Crear ZIP
        zip_file = f'/tmp/na_prod_{consecutivo}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'na_{consecutivo}.xml')
        print(f'✅ ZIP creado: {zip_file}')
        
        # Enviar a DIAN PRODUCCIÓN
        print('\n📤 Enviando a DIAN PRODUCCIÓN...')
        print('='*80)
        
        key_pem_path = f'certificados/{EMPRESA_NIT}/llave_firma.pem'
        cert_pem_path = f'certificados/{EMPRESA_NIT}/certificado_firma.pem'
        client = dian.DianSignatureClient(key_pem_path, cert_pem_path, password=None)
        
        with open(zip_file, 'rb') as f:
            zip_content = f.read()
        
        zip_base64 = base64.b64encode(zip_content).decode('utf-8')
        
        documento_exitoso = False
        
        try:
            # ================================================================
            # PRODUCCIÓN: Usa dian.SendBillSync (NO dian.Habilitacion.SendBillSync)
            # ================================================================
            response = client.request(dian.SendBillSync(
                f'na_{consecutivo}.zip', 
                zip_base64
            ))
            
            print('\n📨 RESPUESTA DE LA DIAN (PRODUCCIÓN):')
            print('='*80)
            
            # Extraer CUDS del XmlDocumentKey
            cuds_documento = None
            if hasattr(response, 'XmlDocumentKey') and response.XmlDocumentKey:
                cuds_documento = response.XmlDocumentKey
                print(f'🔑 CUDS: {cuds_documento}')
            
            # Extraer QR si existe
            qr_code = None
            if hasattr(response, 'QRCode') and response.QRCode:
                qr_code = response.QRCode
                print(f'📱 QR Code: {qr_code[:100]}...' if len(str(qr_code)) > 100 else f'📱 QR Code: {qr_code}')
            
            for attr in dir(response):
                if not attr.startswith('_'):
                    value = getattr(response, attr, None)
                    if value is not None and not callable(value):
                        print(f'{attr}: {value}')
            
            print('\n' + '='*80)
            
            if hasattr(response, 'IsValid'):
                print(f"\n{'✅' if response.IsValid else '❌'} IsValid: {response.IsValid}")
            
            if hasattr(response, 'StatusCode'):
                print(f'📊 StatusCode: {response.StatusCode}')
            
            # Procesar respuesta
            if hasattr(response, 'IsValid') and not response.IsValid:
                # Verificar si es Regla 90 (documento ya procesado anteriormente = éxito)
                es_regla_90 = False
                error_list = []
                if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                    errors = response.ErrorMessage
                    if hasattr(errors, 'string'):
                        error_list = errors.string if isinstance(errors.string, list) else [errors.string]
                    else:
                        error_list = [str(errors)]
                    
                    es_regla_90 = any(
                        bool(re.search(r'regla[:)]?\s*90|procesado\s+anteriormente',
                                      str(error), re.IGNORECASE))
                        for error in error_list
                    )
                
                if es_regla_90:
                    print(f'\n⚠️  Documento ya fue procesado anteriormente por la DIAN (Regla 90)')
                    print(f'   Esto significa que la DIAN YA aceptó este documento previamente.')
                    documento_exitoso = True
                    if num_doc is not None:
                        guardar_consecutivo(num_doc)
                    # Imprimir resultado en formato parseable (éxito)
                    print('\n' + '='*80)
                    print('RESULTADO_EXITOSO')
                    print(f'CONSECUTIVO: {consecutivo}')
                    if cuds_documento:
                        print(f'CUDS: {cuds_documento}')
                    print(f'REGLA_90: true')
                    print('='*80)
                else:
                    print(f'\n❌ NOTA DE AJUSTE RECHAZADA POR LA DIAN')
                    if error_list:
                        print('\n🚫 ERRORES:')
                        for i, error in enumerate(error_list, 1):
                            print(f'   {i}. {error}')
                    
                    sys.exit(1)
            else:
                documento_exitoso = True
                # Guardar consecutivo usado (solo si se usó modo legacy/archivo)
                if num_doc is not None:
                    guardar_consecutivo(num_doc)
                
                print(f'\n✅ ¡NOTA DE AJUSTE ENVIADA EXITOSAMENTE!')
                print(f'   Consecutivo: {consecutivo}')
                if ds_original_ref:
                    print(f'   Afecta DS: {ds_original_ref}')
                if cuds_documento:
                    print(f'   CUDS: {cuds_documento}')
                
                # Imprimir resultado en formato parseable
                print('\n' + '='*80)
                print('RESULTADO_EXITOSO')
                print(f'CONSECUTIVO: {consecutivo}')
                if cuds_documento:
                    print(f'CUDS: {cuds_documento}')
                print(f'XML_FILE: {xml_file}')
                print('='*80)
        
        except Exception as e:
            print(f'\n❌ ERROR al enviar a DIAN: {str(e)}')
            import traceback
            traceback.print_exc()
            sys.exit(1)
    
    except Exception as e:
        print(f'\n❌ ERROR GENERAL: {str(e)}')
        import traceback
        traceback.print_exc()
        sys.exit(1)

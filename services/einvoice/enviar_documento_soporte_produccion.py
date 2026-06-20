#!/usr/bin/env python3
"""
🚀 Script de envío de Documentos Soporte a DIAN - AMBIENTE PRODUCCIÓN
✅ Configurado para ambiente de producción (NO TestSet)
📋 Documento Soporte (Tipo 05) - Soporte DUAL para dos escenarios:
    1. BONO_CLIENTE: HSQ regala bonos a clientes (HSQ=proveedor, Cliente=adquirente)
    2. COMPRA_SNO: HSQ compra de personas no obligadas (SNO=proveedor, HSQ=adquirente)
📋 Lee configuración desde certificados/{NIT}/config_empresa.py y config_dian_produccion.py

⚙️ DIFERENCIAS CON HABILITACIÓN:
   1. URL: vpfe.dian.gov.co (NO vpfe-hab)
   2. Método: dian.SendBillSync (NO dian.Habilitacion.SendBillSync)
   3. NO requiere TestSetId
   4. ProfileExecutionID = 1 (Producción según DIAN)
   5. Archivo config: config_dian_produccion.py

⚙️ PARÁMETROS:
   - sys.argv[1]: NIT de la empresa
   - sys.argv[2]: Consecutivo específico (opcional)
   - sys.argv[3]: tipo_documento_soporte ('BONO_CLIENTE' o 'COMPRA_SNO')
   - sys.argv[4]: ruta al JSON con datos (cliente o proveedor_sno)
"""
import sys
import os
import re
import json
from pathlib import Path


def calcular_dv_nit(nit):
    """
    Calcula el dígito de verificación (DV) de un NIT colombiano.
    
    Según la DIAN, el algoritmo usa los factores: 3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71
    aplicados de derecha a izquierda sobre los dígitos del NIT.
    
    IMPORTANTE: Según Anexo Técnico Documento Soporte (DSAJ24, DSAJ25):
    - Para CustomizationID='10' (Residente), el vendedor SNO SIEMPRE debe usar schemeName='31' (NIT)
    - El schemeID debe contener el DV calculado
    - Esto aplica incluso para personas naturales con cédula de ciudadanía
    
    Args:
        nit: Número de identificación (puede ser NIT de empresa o cédula de persona natural)
    
    Returns:
        str: Dígito verificador (0-9)
    """
    factores = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
    nit_str = str(nit).zfill(15)  # Rellenar con ceros a la izquierda hasta 15 dígitos
    
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
    """
    Genera un código postal válido de 6 dígitos según la estructura DIAN.
    
    Según Anexo Técnico 16.4.4:
    - El código postal en Colombia consta de 6 dígitos (DDZZPP)
    - DD: Código departamento (2 dígitos)
    - ZZ: Zona postal de encaminamiento (00 para capital del departamento)
    - PP: Distrito postal (00-99)
    
    Args:
        codigo_municipio_dane: Código DANE del municipio (5 dígitos, ej: '05001')
        codigo_departamento: Código del departamento (2 dígitos, opcional)
    
    Returns:
        str: Código postal de 6 dígitos
    """
    # Obtener código de departamento (primeros 2 dígitos del código municipio)
    if codigo_departamento:
        dept = str(codigo_departamento).zfill(2)
    elif codigo_municipio_dane:
        dept = str(codigo_municipio_dane)[:2].zfill(2)
    else:
        dept = '11'  # Bogotá por defecto
    
    # Determinar zona de encaminamiento
    # 00 = capital del departamento, 01-89 para otras zonas
    if codigo_municipio_dane:
        # Si el municipio termina en 001 (capital) usar zona 00
        mun_suffix = str(codigo_municipio_dane)[-3:]
        if mun_suffix == '001':
            zona = '00'
        else:
            # Para otros municipios, usar los últimos 2 dígitos del código
            zona = str(codigo_municipio_dane)[-2:].zfill(2)
    else:
        zona = '00'
    
    # Distrito postal (10 por defecto)
    distrito = '10'
    
    codigo_postal = f"{dept}{zona}{distrito}"
    
    # Validar que sea exactamente 6 dígitos
    if len(codigo_postal) != 6:
        # Fallback: departamento + 0001 + 00
        codigo_postal = f"{dept}0010"
    
    return codigo_postal


# Caché global para el catálogo de municipios
_CATALOGO_MUNICIPIOS = None

def cargar_catalogo_municipios():
    """
    Carga el catálogo de municipios de la DIAN una sola vez.
    
    Returns:
        dict: Diccionario {codigo: nombre} con todos los municipios
    """
    global _CATALOGO_MUNICIPIOS
    
    if _CATALOGO_MUNICIPIOS is not None:
        return _CATALOGO_MUNICIPIOS
    
    _CATALOGO_MUNICIPIOS = {}
    
    # Intentar cargar el archivo de municipios DIAN
    rutas_posibles = [
        os.path.join(os.path.dirname(__file__), 'facho', 'fe', 'data', 'dian', 'codelist', 'Municipio-2.1.gc'),
        '/app/facho/fe/data/dian/codelist/Municipio-2.1.gc',
        '/app/zeroset/facho/fe/data/dian/codelist/Municipio-2.1.gc',
    ]
    
    import xml.etree.ElementTree as ET
    
    for ruta in rutas_posibles:
        if os.path.exists(ruta):
            try:
                tree = ET.parse(ruta)
                root = tree.getroot()
                
                # Buscar todos los Row (sin usar namespace para compatibilidad)
                for row in root.iter():
                    if 'Row' in row.tag:
                        code = None
                        name = None
                        for value in row.iter():
                            if 'Value' in value.tag:
                                column_ref = value.get('ColumnRef')
                                for sv in value.iter():
                                    if 'SimpleValue' in sv.tag and sv.text:
                                        if column_ref == 'code':
                                            code = sv.text
                                        elif column_ref == 'name':
                                            name = sv.text
                        if code and name:
                            _CATALOGO_MUNICIPIOS[code] = name
                
                if _CATALOGO_MUNICIPIOS:
                    print(f"✅ Catálogo de municipios cargado: {len(_CATALOGO_MUNICIPIOS)} municipios")
                    break
            except Exception as e:
                print(f"⚠️ Error cargando catálogo de municipios: {e}")
                continue
    
    # Fallback con municipios comunes si no se pudo cargar
    if not _CATALOGO_MUNICIPIOS:
        _CATALOGO_MUNICIPIOS = {
            '05001': 'Medellín',
            '11001': 'Bogotá, D.C.',
            '76001': 'Cali',
            '08001': 'Barranquilla',
            '13001': 'Cartagena de Indias',
            '54001': 'Cúcuta',
            '68001': 'Bucaramanga',
            '50001': 'Villavicencio',
            '17001': 'Manizales',
            '63001': 'Armenia',
            '66001': 'Pereira',
            '05360': 'Itagüí',
            '05088': 'Bello',
            '05266': 'Envigado',
        }
        print(f"⚠️ Usando catálogo de municipios de fallback: {len(_CATALOGO_MUNICIPIOS)} municipios")
    
    return _CATALOGO_MUNICIPIOS


def obtener_nombre_municipio(codigo_municipio, nombre_proporcionado=None):
    """
    Obtiene el nombre oficial del municipio según la DIAN.
    
    Según DSAJ10a, el nombre debe corresponder a la lista oficial de municipios.
    
    Args:
        codigo_municipio: Código DANE del municipio (5 dígitos)
        nombre_proporcionado: Nombre proporcionado (se usa como fallback si no se encuentra el código)
    
    Returns:
        str: Nombre oficial del municipio según la DIAN
    """
    catalogo = cargar_catalogo_municipios()
    
    # Normalizar código
    codigo = str(codigo_municipio).zfill(5) if codigo_municipio else None
    
    # Buscar en el catálogo
    if codigo and codigo in catalogo:
        nombre_oficial = catalogo[codigo]
        if nombre_proporcionado and nombre_proporcionado != nombre_oficial:
            print(f"   ℹ️ Corrigiendo nombre municipio: '{nombre_proporcionado}' → '{nombre_oficial}' (código: {codigo})")
        return nombre_oficial
    
    # Si no se encuentra, usar el proporcionado
    if nombre_proporcionado:
        return nombre_proporcionado
    
    # Fallback por defecto
    return 'Medellín'


# Limpiar caché
import subprocess
subprocess.run(['find', '.', '-name', '*.pyc', '-delete'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['find', '.', '-type', 'd', '-name', '__pycache__', '-exec', 'rm', '-rf', '{}', '+'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Obtener NIT de la empresa (OBLIGATORIO)
if len(sys.argv) > 1:
    EMPRESA_NIT = sys.argv[1]
    sys.argv.pop(1)
else:
    print('❌ ERROR CRÍTICO: No se proporcionó el NIT de la empresa')
    print('   Uso: python3 enviar_documento_soporte_produccion.py <NIT>')
    sys.exit(1)

print(f'🏢 Usando configuración de empresa NIT: {EMPRESA_NIT}')

# Agregar carpeta de la empresa al path
empresa_config_dir = Path(__file__).parent / 'certificados' / EMPRESA_NIT
if not empresa_config_dir.exists():
    print(f'❌ ERROR: No existe la carpeta de configuración para el NIT {EMPRESA_NIT}')
    print(f'   Ruta esperada: {empresa_config_dir}')
    sys.exit(1)

sys.path.insert(0, str(empresa_config_dir))

# IMPORTAR CONFIGURACIONES DE LA EMPRESA
import importlib
import config_empresa

# ============================================================================
# PRODUCCIÓN: Usa config_dian_produccion.py
# ============================================================================
try:
    import config_dian_produccion as config_dian
    importlib.reload(config_dian)
    print('✅ Usando configuración de PRODUCCIÓN (config_dian_produccion.py)')
except ImportError:
    print('❌ ERROR: No existe config_dian_produccion.py en la carpeta del NIT')
    print(f'   Ruta esperada: {empresa_config_dir}/config_dian_produccion.py')
    print('   Por favor, configura el ambiente de Producción desde el frontend.')
    sys.exit(1)

importlib.reload(config_empresa)

print('='*80)
print('📋 CONFIGURACIÓN COMPLETA - DOCUMENTO SOPORTE - PRODUCCIÓN')
print('='*80)
print('\n🏢 DATOS DE LA EMPRESA (ADQUIRENTE):')
print(f'   Razón Social: {config_empresa.EMPRESA_RAZON_SOCIAL}')
print(f'   NIT: {config_empresa.EMPRESA_NIT}')
print(f'   DV: {config_empresa.EMPRESA_DV}')
print(f'   Email: {config_empresa.EMPRESA_EMAIL}')
print(f'   Teléfono: {getattr(config_empresa, "EMPRESA_TELEFONO", "N/A")}')
print(f'   Régimen: {config_empresa.EMPRESA_REGIMEN}')
print(f'   Responsabilidades: {config_empresa.EMPRESA_RESPONSABILIDADES}')
print('\n📍 UBICACIÓN:')
print(f'   Dirección: {config_empresa.EMPRESA_DIRECCION}')
print(f'   Ciudad: {config_empresa.EMPRESA_CIUDAD_NOMBRE} (Código: {config_empresa.EMPRESA_CIUDAD_CODIGO})')
print(f'   Departamento: {config_empresa.EMPRESA_DEPARTAMENTO_NOMBRE} (Código: {config_empresa.EMPRESA_DEPARTAMENTO_CODIGO})')
print(f'   País: CO (Colombia)')
print('\n🔐 CONFIGURACIÓN DIAN - SOFTWARE PRODUCCIÓN:')
print(f'   Software ID: {config_dian.SOFTWARE_ID}')
print(f'   PIN: {config_dian.PIN[:4]}***{config_dian.PIN[-4:] if len(config_dian.PIN) > 8 else "***"}')
print(f'   Clave Técnica: {config_dian.CLAVE_TECNICA[:8]}...{config_dian.CLAVE_TECNICA[-8:] if len(config_dian.CLAVE_TECNICA) > 16 else "***"}')
print(f'   Certificado Password: {"***" + config_dian.CERTIFICADO_PASSWORD[-4:] if len(config_dian.CERTIFICADO_PASSWORD) > 4 else "***"}')
print('\n📄 RESOLUCIÓN DOCUMENTO SOPORTE (PRODUCCIÓN):')
print(f'   Número Resolución: {getattr(config_dian, "RESOLUCION_DS_NUMERO", "NO CONFIGURADO")}')
print(f'   Prefijo: {getattr(config_dian, "RESOLUCION_DS_PREFIJO", "NO CONFIGURADO")}')
print(f'   Rango Desde: {getattr(config_dian, "RESOLUCION_DS_NUMERO_DESDE", "NO CONFIGURADO")}')
print(f'   Rango Hasta: {getattr(config_dian, "RESOLUCION_DS_NUMERO_HASTA", "NO CONFIGURADO")}')
print(f'   Fecha Vigencia Desde: {getattr(config_dian, "RESOLUCION_DS_FECHA_DESDE", "NO CONFIGURADO")}')
print(f'   Fecha Vigencia Hasta: {getattr(config_dian, "RESOLUCION_DS_FECHA_HASTA", "NO CONFIGURADO")}')
print('\n🌍 AMBIENTE:')
print(f'   Ambiente: 🔴 PRODUCCIÓN (Documentos REALES)')
print(f'   URL: https://vpfe.dian.gov.co/WcfDianCustomerServices.svc')
print('='*80 + '\n')

from facho.fe import form, form_xml, fe
from facho.fe.client import dian
from datetime import datetime, timezone, timedelta
import zipfile
import base64

# ============================================================================
# ZONA HORARIA COLOMBIA (UTC-5)
# ============================================================================
COLOMBIA_TZ = timezone(timedelta(hours=-5))

def hora_colombia():
    """Obtiene la fecha/hora actual en zona horaria de Colombia (UTC-5)"""
    return datetime.now(COLOMBIA_TZ)

# ============================================================================
# CONFIGURACIÓN EMPRESA
# ============================================================================
EMPRESA_NIT = config_empresa.EMPRESA_NIT
EMPRESA_DV = config_empresa.EMPRESA_DV
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

# Resolución Documento Soporte - PRODUCCIÓN
RESOLUCION_NUMERO = getattr(config_dian, 'RESOLUCION_DS_NUMERO', '')
RESOLUCION_FECHA_DESDE = getattr(config_dian, 'RESOLUCION_DS_FECHA_DESDE', None)
RESOLUCION_FECHA_HASTA = getattr(config_dian, 'RESOLUCION_DS_FECHA_HASTA', None)
RESOLUCION_PREFIJO = getattr(config_dian, 'RESOLUCION_DS_PREFIJO', '')
RESOLUCION_NUMERO_DESDE = getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', 0)
RESOLUCION_NUMERO_HASTA = getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', 0)

# ============================================================================
# VALIDACIÓN DE CONFIGURACIÓN
# ============================================================================
print('='*80)
print('🔍 VALIDANDO CONFIGURACIÓN DE DOCUMENTO SOPORTE - PRODUCCIÓN')
print('='*80)

campos_requeridos = {
    'RESOLUCION_DS_NUMERO': RESOLUCION_NUMERO,
    'RESOLUCION_DS_PREFIJO': RESOLUCION_PREFIJO,
    'RESOLUCION_DS_NUMERO_DESDE': RESOLUCION_NUMERO_DESDE,
    'RESOLUCION_DS_NUMERO_HASTA': RESOLUCION_NUMERO_HASTA
    # NOTA: NO se requiere TEST_SET_ID_DS en producción
}

campos_vacios = []
for campo, valor in campos_requeridos.items():
    if not valor or valor == '' or valor == 0:
        campos_vacios.append(campo)
        print(f'❌ {campo}: NO CONFIGURADO')
    else:
        print(f'✅ {campo}: {valor}')

if campos_vacios:
    print('='*80)
    print('❌ ERROR: CONFIGURACIÓN INCOMPLETA')
    print('='*80)
    print('Los siguientes campos de Documento Soporte no están configurados:')
    for campo in campos_vacios:
        print(f'  - {campo}')
    print('\n⚠️  Por favor, configura todos los campos desde el frontend.')
    print('   Ve a: Configuración > PRODUCCIÓN > Resolución > DOCUMENTO SOPORTE')
    print('='*80)
    sys.exit(1)

print('='*80)
print('✅ CONFIGURACIÓN VÁLIDA - Procediendo con el envío a PRODUCCIÓN')
print('='*80)

# ============================================================================
# PARÁMETROS ADICIONALES: TIPO DE DS Y DATOS DINÁMICOS
# ============================================================================
TIPO_DOCUMENTO_SOPORTE = None
DATOS_DINAMICOS = None
CONSECUTIVO_ESPECIFICO = None

if len(sys.argv) >= 2:
    arg1 = sys.argv[1]
    
    if arg1 in ['BONO_CLIENTE', 'COMPRA_SNO']:
        TIPO_DOCUMENTO_SOPORTE = arg1
        if len(sys.argv) >= 3:
            json_path = sys.argv[2]
            if os.path.exists(json_path):
                print(f'\n📋 Cargando datos dinámicos desde: {json_path}')
                with open(json_path, 'r', encoding='utf-8') as f:
                    DATOS_DINAMICOS = json.load(f)
                print(f'✅ Tipo de Documento Soporte: {TIPO_DOCUMENTO_SOPORTE}')
    else:
        try:
            CONSECUTIVO_ESPECIFICO = int(arg1)
            if len(sys.argv) >= 3:
                arg2 = sys.argv[2]
                if arg2 in ['BONO_CLIENTE', 'COMPRA_SNO']:
                    TIPO_DOCUMENTO_SOPORTE = arg2
                    if len(sys.argv) >= 4:
                        json_path = sys.argv[3]
                        if os.path.exists(json_path):
                            with open(json_path, 'r', encoding='utf-8') as f:
                                DATOS_DINAMICOS = json.load(f)
        except ValueError:
            pass

if not TIPO_DOCUMENTO_SOPORTE:
    TIPO_DOCUMENTO_SOPORTE = 'COMPRA_SNO'
    print('\n⚠️  Modo legacy: usando COMPRA_SNO con datos hardcoded')

print('='*80)

# ============================================================================
# AMBIENTE PRODUCCIÓN
# ============================================================================
AMBIENTE = fe.AMBIENTE_PRODUCCION  # ProfileExecutionID = 1 (Producción)

# Archivo de consecutivos específico para producción
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_soporte_prod.txt'


# ============================================================================
# FUNCIÓN: EXTENSIONES DIAN
# ============================================================================
def extensions(inv):
    """
    Genera las extensiones XML requeridas por la DIAN para Documento Soporte - PRODUCCIÓN
    """
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        ID_SOFTWARE, 
        PIN_SOFTWARE, 
        inv.invoice_ident
    )
    
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    # CUDS para Documento Soporte - Usa Software-PIN (no Clave Técnica)
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
# FUNCIÓN: CREAR DOCUMENTO SOPORTE
# ============================================================================
def support_document():
    """
    Crea un Documento Soporte con datos reales - PRODUCCIÓN
    Usa form.SupportDocument() que tiene InvoiceTypeCode='05' y 
    valida CustomizationID contra TipoOperacionDS (10=Residente, 11=No Residente)
    """
    # Usar SupportDocument para Documento Soporte (InvoiceTypeCode='05')
    # En lugar de Invoice('01') que es para Factura de Venta Nacional
    inv = form.SupportDocument()
    
    # Usar hora de Colombia (UTC-5) para todas las fechas del documento
    ahora_colombia = hora_colombia()
    inv.set_period(ahora_colombia, ahora_colombia)
    inv.set_issue(ahora_colombia)
    
    # ========================================================================
    # TIPO DE OPERACIÓN: 10 = Residente, 11 = No Residente
    # Resolución 000227, Art. 1.5.2.2.3 (No residentes)
    # ========================================================================
    es_no_residente = False
    if DATOS_DINAMICOS:
        datos_persona = DATOS_DINAMICOS.get('cliente') or DATOS_DINAMICOS.get('proveedor_sno') or {}
        es_no_residente = datos_persona.get('es_residente') == False
    
    if es_no_residente:
        inv.set_operation_type('11')  # CustomizationID=11 (No Residente)
        print(f'📋 CustomizationID=11 → NO RESIDENTE (Resolución 000227, Art. 1.5.2.2.3)')
    else:
        inv.set_operation_type('10')  # CustomizationID=10 (Residente)
        print(f'📋 CustomizationID=10 → RESIDENTE')
    
    if TIPO_DOCUMENTO_SOPORTE == 'BONO_CLIENTE':
        print(f'📦 Configurando DS para: BONO A CLIENTE')
        
        # HSQ como customer (EMISOR del documento)
        customer = form.Party(
            legal_name=EMPRESA_RAZON_SOCIAL,
            name=EMPRESA_NOMBRE_COMERCIAL,
            ident=form.PartyIdentification(EMPRESA_NIT, EMPRESA_DV, '31'),
            responsability_code=form.Responsability(EMPRESA_RESPONSABILIDADES),
            responsability_regime_code=EMPRESA_REGIMEN,
            organization_code=EMPRESA_TIPO_ORGANIZACION,
            email=EMPRESA_EMAIL,
            phone=getattr(config_empresa, 'EMPRESA_TELEFONO', '3001234567'),
            # DSAK40: TaxScheme '01' (IVA) para el Adquirente (ABS)
            tax_scheme=form.TaxScheme('01'),
            address=form.Address(
                name=EMPRESA_DIRECCION,
                street=EMPRESA_DIRECCION,
                city=form.City(EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE),
                country=form.Country(EMPRESA_PAIS, 'Colombia'),
                countrysubentity=form.CountrySubentity(
                    EMPRESA_DEPARTAMENTO_CODIGO, EMPRESA_DEPARTAMENTO_NOMBRE
                ),
                # PostalZone: código postal de 6 dígitos (DSAJ73)
                postal_code=getattr(config_empresa, 'EMPRESA_CODIGO_POSTAL', 
                    generar_codigo_postal(EMPRESA_CIUDAD_CODIGO, EMPRESA_DEPARTAMENTO_CODIGO))
            )
        )
        inv.set_customer(customer)
        
        # Cliente como supplier (Vendedor SNO)
        # OBLIGATORIO: Los datos del cliente deben venir del backend
        if not DATOS_DINAMICOS or 'cliente' not in DATOS_DINAMICOS:
            raise ValueError(
                "❌ ERROR CRÍTICO: No se proporcionaron datos del cliente (beneficiario del bono). "
                "Este script SOLO puede ejecutarse con datos reales desde el backend."
            )
        
        cliente = DATOS_DINAMICOS['cliente']
        numero_doc = cliente.get('numero_documento')
        if not numero_doc:
            raise ValueError("❌ ERROR: El cliente no tiene número de documento")
        
        # ★ Determinar si es NO RESIDENTE
        cliente_es_residente = cliente.get('es_residente', True)
        
        if cliente_es_residente:
            # ================================================================
            # RESIDENTE: DSAJ25a → Forzar NIT (31) + DV calculado
            # ================================================================
            dv_calculado = calcular_dv_nit(numero_doc)
            print(f"\n📋 DATOS DEL VENDEDOR SNO (RESIDENTE - Anexo Técnico DIAN):")
            print(f"   Número documento: {numero_doc}")
            print(f"   DV calculado: {dv_calculado}")
            print(f"   schemeName: 31 (NIT - requerido para Residente según DSAJ25)")
            
            supplier = form.Party(
                legal_name=f"{cliente.get('nombres', '')} {cliente.get('apellidos', '')}".strip(),
                name=f"{cliente.get('nombres', '')} {cliente.get('apellidos', '')}".strip(),
                ident=form.PartyIdentification(
                    numero_doc,
                    dv_calculado,
                    '31'  # SIEMPRE '31' para Residente según DSAJ25
                ),
                responsability_code=form.Responsability(['R-99-PN']),
                responsability_regime_code='49',
                organization_code='2',  # Persona Natural
                email=cliente.get('email', ''),
                phone=cliente.get('telefono', ''),
                tax_scheme=form.TaxScheme('ZZ'),
                address=form.Address(
                    name=cliente.get('direccion', 'Sin dirección'),
                    street=cliente.get('direccion', 'Sin dirección'),
                    city=form.City(
                        cliente.get('ciudad_codigo', cliente.get('codigo_ciudad', '05001')),
                        obtener_nombre_municipio(
                            cliente.get('ciudad_codigo', cliente.get('codigo_ciudad', '05001')),
                            cliente.get('ciudad_nombre', cliente.get('ciudad', 'Medellín'))
                        )
                    ),
                    country=form.Country('CO', 'Colombia'),
                    countrysubentity=form.CountrySubentity(
                        cliente.get('departamento_codigo', cliente.get('codigo_departamento', '05')),
                        cliente.get('departamento_nombre', cliente.get('departamento', 'Antioquia'))
                    ),
                    postal_code=cliente.get('codigo_postal', generar_codigo_postal(
                        cliente.get('ciudad_codigo', cliente.get('codigo_ciudad', '05001')),
                        cliente.get('departamento_codigo', cliente.get('codigo_departamento', '05'))
                    ))
                )
            )
            inv.set_supplier(supplier)
            print(f'   Cliente RESIDENTE: {cliente.get("nombres")} '
                  f'{cliente.get("apellidos")} - NIT:{numero_doc}-{dv_calculado}')
        else:
            # ================================================================
            # NO RESIDENTE: DSAJ25b → Tipo real + sin DV + dirección simple
            # Resolución 000227, Art. 1.5.2.2.3
            # ================================================================
            tipo_documento_fiscal = cliente.get('tipo_documento', '41')
            dv_no_residente = ''  # Sin DV para no residentes
            
            print(f"\n📋 DATOS DEL VENDEDOR SNO (NO RESIDENTE):")
            print(f"   Número documento: {numero_doc}")
            print(f"   Tipo documento fiscal: {tipo_documento_fiscal}")
            print(f"   Sin DV (no residente)")
            
            supplier = form.Party(
                legal_name=f"{cliente.get('nombres', '')} {cliente.get('apellidos', '')}".strip(),
                name=f"{cliente.get('nombres', '')} {cliente.get('apellidos', '')}".strip(),
                ident=form.PartyIdentification(
                    numero_doc,
                    dv_no_residente,
                    tipo_documento_fiscal
                ),
                responsability_code=form.Responsability(['R-99-PN']),
                responsability_regime_code='49',
                organization_code=cliente.get('tipo_persona', '2'),
                email=cliente.get('email', ''),
                phone=cliente.get('telefono', ''),
                tax_scheme=form.TaxScheme('ZZ'),
                # ★ Dirección extranjera (con CountrySubentity + AddressLine para DSAJ14)
                address=form.ForeignAddress(
                    city_name=cliente.get('ciudad_nombre', ''),
                    country_code=cliente.get('pais', 'US'),
                    country_name=cliente.get('pais_nombre', ''),
                    address_line=cliente.get('direccion', ''),
                    state_province=cliente.get('estado_provincia', '')
                )
            )
            inv.set_supplier(supplier)
            print(f'   Cliente NO RESIDENTE: {cliente.get("nombres")} '
                  f'{cliente.get("apellidos")} - '
                  f'Doc {tipo_documento_fiscal}: {numero_doc} — '
                  f'{cliente.get("ciudad_nombre")}, {cliente.get("pais_nombre")}')
        
    else:  # COMPRA_SNO
        print(f'📦 Configurando DS para: COMPRA A SNO')
        
        # OBLIGATORIO: Los datos del proveedor SNO deben venir del backend
        if not DATOS_DINAMICOS or 'proveedor_sno' not in DATOS_DINAMICOS:
            raise ValueError(
                "❌ ERROR CRÍTICO: No se proporcionaron datos del proveedor SNO. "
                "Este script SOLO puede ejecutarse con datos reales desde el backend."
            )
        
        # SNO como supplier - aplicar mismas reglas del Anexo Técnico
        proveedor = DATOS_DINAMICOS['proveedor_sno']
        numero_doc = proveedor.get('numero_documento')
        if not numero_doc:
            raise ValueError("❌ ERROR: El proveedor SNO no tiene número de documento")
        
        # ★ Determinar si es NO RESIDENTE
        prov_es_residente = proveedor.get('es_residente', True)
        
        if prov_es_residente:
            # ================================================================
            # RESIDENTE: DSAJ25a → NIT (31) + DV
            # ================================================================
            dv_calculado = calcular_dv_nit(numero_doc)
            print(f"\n📋 DATOS DEL PROVEEDOR SNO (RESIDENTE - Anexo Técnico DIAN):")
            print(f"   Número documento: {numero_doc}")
            print(f"   DV calculado: {dv_calculado}")
            print(f"   schemeName: 31 (NIT - requerido para Residente según DSAJ25)")
            
            supplier = form.Party(
                    legal_name=f"{proveedor.get('nombres', '')} {proveedor.get('apellidos', '')}".strip(),
                    name=f"{proveedor.get('nombres', '')} {proveedor.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        dv_calculado,
                        '31'  # SIEMPRE '31' para Residente
                    ),
                    responsability_code=form.Responsability(['R-99-PN']),
                    responsability_regime_code='49',
                    organization_code='2',
                    email=proveedor.get('email', ''),
                    phone=proveedor.get('telefono', ''),
                    tax_scheme=form.TaxScheme('ZZ'),
                    address=form.Address(
                        name=proveedor.get('direccion', 'Sin dirección'),
                        street=proveedor.get('direccion', 'Sin dirección'),
                        city=form.City(
                            proveedor.get('ciudad_codigo', proveedor.get('codigo_ciudad', '05001')),
                            obtener_nombre_municipio(
                                proveedor.get('ciudad_codigo', proveedor.get('codigo_ciudad', '05001')),
                                proveedor.get('ciudad_nombre', proveedor.get('ciudad', 'Medellín'))
                            )
                        ),
                        country=form.Country('CO', 'Colombia'),
                        countrysubentity=form.CountrySubentity(
                            proveedor.get('departamento_codigo', proveedor.get('codigo_departamento', '05')),
                            proveedor.get('departamento_nombre', proveedor.get('departamento', 'Antioquia'))
                        ),
                        postal_code=proveedor.get('codigo_postal', generar_codigo_postal(
                            proveedor.get('ciudad_codigo', proveedor.get('codigo_ciudad', '05001')),
                            proveedor.get('departamento_codigo', proveedor.get('codigo_departamento', '05'))
                        ))
                    )
                )
            inv.set_supplier(supplier)
            print(f'   Proveedor RESIDENTE: {proveedor.get("nombres")} '
                  f'{proveedor.get("apellidos")} - NIT:{numero_doc}-{dv_calculado}')
        else:
            # ================================================================
            # NO RESIDENTE: DSAJ25b → tipo real + sin DV + dirección simple
            # ================================================================
            tipo_documento_fiscal = proveedor.get('tipo_documento', '42')
            print(f"\n📋 DATOS DEL PROVEEDOR SNO (NO RESIDENTE):")
            print(f"   Número documento: {numero_doc}")
            print(f"   Tipo documento fiscal: {tipo_documento_fiscal}")
            print(f"   Sin DV (no residente)")
            
            supplier = form.Party(
                    legal_name=f"{proveedor.get('nombres', '')} {proveedor.get('apellidos', '')}".strip(),
                    name=f"{proveedor.get('nombres', '')} {proveedor.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        '',  # Sin DV para no residentes
                        tipo_documento_fiscal
                    ),
                    responsability_code=form.Responsability(['R-99-PN']),
                    responsability_regime_code='49',
                    organization_code=proveedor.get('tipo_persona', '2'),
                    email=proveedor.get('email', ''),
                    phone=proveedor.get('telefono', ''),
                    tax_scheme=form.TaxScheme('ZZ'),
                    # ★ Dirección extranjera (con CountrySubentity + AddressLine para DSAJ14)
                    address=form.ForeignAddress(
                        city_name=proveedor.get('ciudad_nombre', ''),
                        country_code=proveedor.get('pais', 'US'),
                        country_name=proveedor.get('pais_nombre', ''),
                        address_line=proveedor.get('direccion', ''),
                        state_province=proveedor.get('estado_provincia', '')
                    )
                )
            inv.set_supplier(supplier)
            print(f'   Proveedor NO RESIDENTE: {proveedor.get("nombres")} '
                  f'{proveedor.get("apellidos")} - '
                  f'Doc {tipo_documento_fiscal}: {numero_doc} — '
                  f'{proveedor.get("ciudad_nombre")}, {proveedor.get("pais_nombre")}')
        
        # HSQ como customer (adquirente)
        customer = form.Party(
            legal_name=EMPRESA_RAZON_SOCIAL,
            name=EMPRESA_NOMBRE_COMERCIAL,
            ident=form.PartyIdentification(EMPRESA_NIT, EMPRESA_DV, '31'),
            responsability_code=form.Responsability(EMPRESA_RESPONSABILIDADES),
            responsability_regime_code=EMPRESA_REGIMEN,
            organization_code=EMPRESA_TIPO_ORGANIZACION,
            email=EMPRESA_EMAIL,
            phone=getattr(config_empresa, 'EMPRESA_TELEFONO', '3001234567'),
            # DSAK40: TaxScheme '01' (IVA) para el Adquirente (ABS)
            tax_scheme=form.TaxScheme('01'),
            address=form.Address(
                name=EMPRESA_DIRECCION,
                street=EMPRESA_DIRECCION,
                city=form.City(EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE),
                country=form.Country(EMPRESA_PAIS, 'Colombia'),
                countrysubentity=form.CountrySubentity(
                    EMPRESA_DEPARTAMENTO_CODIGO, EMPRESA_DEPARTAMENTO_NOMBRE
                ),
                # PostalZone: código postal de 6 dígitos (DSAJ73)
                postal_code=getattr(config_empresa, 'EMPRESA_CODIGO_POSTAL', 
                    generar_codigo_postal(EMPRESA_CIUDAD_CODIGO, EMPRESA_DEPARTAMENTO_CODIGO))
            )
        )
        inv.set_customer(customer)
    
    # Forma de pago
    inv.set_payment_mean(form.PaymentMean(
        id='1',
        code='10',  # Efectivo
        due_at=hora_colombia(),
        payment_id='1'
    ))
    
    # ========================================================================
    # LÍNEA DE DOCUMENTO: Servicio o Bien adquirido
    # ========================================================================
    # OBLIGATORIO: Datos del bono deben venir del backend
    if not DATOS_DINAMICOS or 'bono' not in DATOS_DINAMICOS:
        raise ValueError(
            "❌ ERROR CRÍTICO: No se proporcionaron datos del bono. "
            "Este script SOLO puede ejecutarse con datos reales desde el backend. "
            "No se permiten datos de prueba o valores por defecto."
        )
    
    bono = DATOS_DINAMICOS['bono']
    cantidad = float(bono.get('cantidad', 1))
    unidad_medida = str(bono.get('unidad_medida', '94'))
    descripcion = bono.get('descripcion', bono.get('concepto_descripcion', 'BONO Y PREMIO'))
    codigo_unspsc = str(bono.get('concepto_unspsc', '82141505'))
    concepto_descripcion = bono.get('concepto_descripcion', 'Premios e incentivos')
    valor_unitario = float(bono.get('valor_unitario', bono.get('valor_total', 0)))
    
    print(f'\n📦 Datos del BONO (desde backend):')
    print(f'   Cantidad: {cantidad}')
    print(f'   Descripción: {descripcion}')
    print(f'   UNSPSC: {codigo_unspsc} - {concepto_descripcion}')
    print(f'   Valor Unitario: ${valor_unitario:,.2f}')
    
    # ========================================================================
    # RETENCIÓN EN LA FUENTE (WithholdingTaxTotal) - Solo para BONO Y PREMIO
    # ========================================================================
    # Según Art. 306 del Estatuto Tributario, los premios de loterías, rifas, 
    # apuestas y similares están sujetos a retención del 20% (ReteRenta código 06)
    # Esto aplica SOLO cuando descripcion = "BONO Y PREMIO"
    # 
    # Según Anexo Técnico DIAN v1.1 (DSAT01-DSAT13):
    # - WithholdingTaxTotal es OPCIONAL (0..N)
    # - Se informa en el elemento cac:WithholdingTaxTotal
    # - Código tributo 06 = ReteRenta (Retención en la Fuente sobre Renta)
    # - Tarifa 20% según Tabla 16.3.8 para "Loterías, rifas, apuestas y similares"
    
    if descripcion and descripcion.upper() == 'BONO Y PREMIO':
        # Calcular base y retención
        valor_total = cantidad * valor_unitario
        porcentaje_retencion = 20.0  # 20% según Art. 306 ET y Tabla DIAN 16.3.8
        valor_retencion = valor_total * (porcentaje_retencion / 100)
        
        print(f'\n💰 RETENCIÓN EN LA FUENTE (Art. 306 ET):')
        print(f'   Tipo: BONO Y PREMIO (aplica retención)')
        print(f'   Base Gravable: ${valor_total:,.2f}')
        print(f'   Tarifa: {porcentaje_retencion}%')
        print(f'   Valor Retención: ${valor_retencion:,.2f}')
        
        # Crear WithholdingTaxTotal
        withholding_subtotal = form.WithholdingTaxSubTotal(
            percent=porcentaje_retencion,
            scheme=form.TaxScheme('06'),  # 06 = ReteRenta
            tax_amount=form.Amount(valor_retencion),
            taxable_amount=form.Amount(valor_total)
        )
        
        withholding_tax = form.WithholdingTaxTotal(
            subtotals=[withholding_subtotal],
            tax_amount=form.Amount(valor_retencion)
        )
        
        # Establecer la retención en el invoice
        inv.set_withholding_tax_total(withholding_tax)
        
        print(f'   ✅ WithholdingTaxTotal configurado para XML')
    else:
        print(f'\n💰 RETENCIÓN EN LA FUENTE:')
        print(f'   Tipo: {descripcion} (NO aplica retención)')
        print(f'   WithholdingTaxTotal: NO se incluirá en XML')
    
    # Para ítems EXCLUIDOS de IVA: NO se debe enviar TaxTotal según Anexo Técnico DIAN
    # Regla DSAX01: "Este grupo NO debe ser informado para ítems excluidos de acuerdo a lo establecido en el ET"
    inv.add_invoice_line(form.InvoiceLine(
        quantity=form.Quantity(cantidad, unidad_medida),
        description=descripcion,
        item=form.UNSPSCItem(codigo_unspsc, concepto_descripcion),
        price=form.Price(
            amount=form.Amount(valor_unitario),
            type_code='01',
            type='x'
        ),
        # En documento soporte a no obligados, usualmente no hay IVA descontable generado por el vendedor
        # Para bienes/servicios EXCLUIDOS: NO enviar TaxTotal (usar TaxTotalOmit)
        tax=form.TaxTotalOmit()  # Excluido de IVA - no envía elemento TaxTotal en XML
    ))
    
    return inv


def document_xml():
    """Genera el XML con el formato UBL para Documento Soporte"""
    return form_xml.DIANSupportDocumentXML


# ============================================================================
# SISTEMA DE CONSECUTIVOS
# ============================================================================
def obtener_consecutivo(especifico=None):
    if especifico:
        return int(especifico)
    
    try:
        if os.path.exists(CONSECUTIVO_FILE):
            with open(CONSECUTIVO_FILE, 'r') as f:
                ultimo = int(f.read().strip())
            return ultimo + 1
    except:
        pass
    
    return RESOLUCION_NUMERO_DESDE


def guardar_consecutivo(num):
    os.makedirs(os.path.dirname(CONSECUTIVO_FILE), exist_ok=True)
    with open(CONSECUTIVO_FILE, 'w') as f:
        f.write(str(num))


def guardar_validacion_dian(nit, consecutivo, response, xml_file=None, zip_file=None, ambiente="produccion"):
    """
    Guarda la respuesta de validación de la DIAN como un archivo JSON (el "timbrado").
    
    Este archivo contiene toda la información de la validación:
    - XmlDocumentKey (CUDS) - El hash SHA-384 que identifica el documento ante la DIAN
    - IsValid - Si el documento fue aceptado
    - StatusCode - Código de estado
    - StatusDescription - Descripción del estado
    - ErrorMessage - Errores si los hay
    - Fecha/hora de la validación
    - Archivos asociados (XML, ZIP)
    
    Args:
        nit: NIT de la empresa
        consecutivo: Consecutivo del documento (ej: "SEDS1" o "DCSW1")
        response: Objeto de respuesta del servicio DIAN
        xml_file: Ruta al archivo XML firmado
        zip_file: Ruta al archivo ZIP
        ambiente: "produccion" o "habilitacion"
    
    Returns:
        str: Ruta del archivo JSON guardado
    """
    from datetime import datetime
    
    # Directorio de documentos
    docs_dir = Path(__file__).parent / "certificados" / str(nit) / "documentos"
    docs_dir.mkdir(parents=True, exist_ok=True)
    
    # Extraer todos los atributos de la respuesta DIAN
    validacion = {
        "documento": {
            "consecutivo": consecutivo,
            "tipo": "DocumentoSoporte",
            "ambiente": ambiente,
            "nit_empresa": nit
        },
        "validacion_dian": {
            "fecha_validacion": datetime.now().isoformat(),
            "XmlDocumentKey": None,  # CUDS
            "IsValid": None,
            "StatusCode": None,
            "StatusDescription": None,
            "StatusMessage": None,
            "ErrorMessage": [],
            "QRCode": None,
        },
        "archivos": {
            "xml_firmado": str(xml_file) if xml_file else None,
            "zip": str(zip_file) if zip_file else None,
            "validacion_json": None  # Se llenará abajo
        },
        "metadata": {
            "version": "1.0",
            "generado_por": "SCRB-DIAN-Integration",
            "fecha_generacion": datetime.now().isoformat()
        }
    }
    
    # Extraer atributos de la respuesta
    if hasattr(response, 'XmlDocumentKey') and response.XmlDocumentKey:
        validacion["validacion_dian"]["XmlDocumentKey"] = response.XmlDocumentKey
    
    if hasattr(response, 'IsValid'):
        validacion["validacion_dian"]["IsValid"] = response.IsValid
    
    if hasattr(response, 'StatusCode'):
        validacion["validacion_dian"]["StatusCode"] = response.StatusCode
    
    if hasattr(response, 'StatusDescription'):
        validacion["validacion_dian"]["StatusDescription"] = response.StatusDescription
    
    if hasattr(response, 'StatusMessage'):
        validacion["validacion_dian"]["StatusMessage"] = response.StatusMessage
    
    if hasattr(response, 'QRCode') and response.QRCode:
        validacion["validacion_dian"]["QRCode"] = response.QRCode
    
    # Extraer errores si los hay
    if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
        errors = response.ErrorMessage
        if hasattr(errors, 'string'):
            error_list = errors.string if isinstance(errors.string, list) else [errors.string]
        else:
            error_list = [str(errors)] if errors else []
        validacion["validacion_dian"]["ErrorMessage"] = error_list
    
    # Nombre del archivo JSON
    # Extraer solo el identificador del consecutivo (ej: SEDS1 -> 1, DCSW5 -> 5)
    import re
    match = re.search(r'(\d+)$', str(consecutivo))
    numero = match.group(1) if match else consecutivo
    
    # Determinar el prefijo basado en el ambiente
    prefijo_archivo = f"ds_{ambiente[:4]}"  # ds_prod o ds_habi
    json_filename = f"{prefijo_archivo}_validacion_{consecutivo}.json"
    json_path = docs_dir / json_filename
    
    validacion["archivos"]["validacion_json"] = str(json_path)
    
    # Guardar el archivo JSON
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(validacion, f, ensure_ascii=False, indent=2, default=str)
    
    print(f"📋 Validación DIAN guardada: {json_path}")
    return str(json_path)


# ============================================================================
# EJECUCIÓN PRINCIPAL
# ============================================================================
if __name__ == '__main__':
    print('\n' + '🔴'*40)
    print('⚠️  ATENCIÓN: ENVIANDO A AMBIENTE DE PRODUCCIÓN')
    print('    Los documentos enviados tienen valor legal y tributario')
    print('🔴'*40 + '\n')
    
    # Obtener consecutivo
    if CONSECUTIVO_ESPECIFICO:
        num_documento_inicial = CONSECUTIVO_ESPECIFICO
        print(f'ℹ️  Usando número especificado: {num_documento_inicial}')
    else:
        num_documento_inicial = obtener_consecutivo()
        print(f'ℹ️  Usando siguiente consecutivo: {num_documento_inicial}')
    
    # Validar rango
    if num_documento_inicial < RESOLUCION_NUMERO_DESDE or num_documento_inicial > RESOLUCION_NUMERO_HASTA:
        print(f'❌ ERROR: Consecutivo {num_documento_inicial} fuera del rango autorizado')
        print(f'   Rango válido: {RESOLUCION_NUMERO_DESDE} - {RESOLUCION_NUMERO_HASTA}')
        sys.exit(1)
    
    MAX_INTENTOS = getattr(config_dian, 'MAX_INTENTOS_ENVIO', 5)
    num_documento = num_documento_inicial
    intento = 0
    
    while intento < MAX_INTENTOS:
        intento += 1
        if intento > 1:
            print(f"\n🔄 Reintento {intento}/{MAX_INTENTOS} con consecutivo: {num_documento}")
        
        print("="*80)
        print(f"📋 ENVIANDO DS {RESOLUCION_PREFIJO}{num_documento} A DIAN PRODUCCIÓN")
        print(f"    Tipo: {TIPO_DOCUMENTO_SOPORTE}")
        print("="*80)
        
        # Generar documento
        inv = support_document()
        inv.set_ident(f'{RESOLUCION_PREFIJO}{num_documento}')
        inv.calculate()
        
        print(f"\n✅ Documento Soporte generado: {inv.invoice_ident}")
        print(f"   Adquirente: {EMPRESA_RAZON_SOCIAL} (NIT {EMPRESA_NIT}-{EMPRESA_DV})")
        print(f"   Total: ${inv.invoice_legal_monetary_total.payable_amount.float():,.2f}")
        
        print('\n📊 DATOS QUE SE ENVIARÁN EN EL XML:')
        print(f'   Consecutivo: {inv.invoice_ident}')
        print(f'   Prefijo: {RESOLUCION_PREFIJO}')
        print(f'   Resolución: {RESOLUCION_NUMERO}')
        print(f'   Rango: {RESOLUCION_NUMERO_DESDE} - {RESOLUCION_NUMERO_HASTA}')
        print(f'   Software ID: {ID_SOFTWARE}')
        print(f'   Ambiente: 🔴 PRODUCCIÓN (ProfileExecutionID=1)')
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        # Firmar XML
        xml_file = f'/tmp/ds_prod_{inv.invoice_ident}_firmado.xml'
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f"✅ XML firmado: {xml_file}")
        
        # Crear ZIP
        zip_file = f'/tmp/ds_prod_{inv.invoice_ident}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'ds_{inv.invoice_ident}.xml')
        print(f"✅ ZIP creado: {zip_file}")
        
        # Enviar a DIAN PRODUCCIÓN
        print("\n📤 Enviando a DIAN PRODUCCIÓN...")
        print("="*80)
        
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
                f'ds_{inv.invoice_ident}.zip', 
                zip_base64
            ))
            
            print("\n📨 RESPUESTA DE LA DIAN (PRODUCCIÓN):")
            print("="*80)
            
            # Extraer CUDS del XmlDocumentKey
            cuds_documento = None
            if hasattr(response, 'XmlDocumentKey') and response.XmlDocumentKey:
                cuds_documento = response.XmlDocumentKey
                print(f"🔑 CUDS: {cuds_documento}")
            
            # Extraer QR si existe
            qr_code = None
            if hasattr(response, 'QRCode') and response.QRCode:
                qr_code = response.QRCode
                print(f"📱 QR Code: {qr_code[:100]}..." if len(str(qr_code)) > 100 else f"📱 QR Code: {qr_code}")
            
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
            
            # Procesar respuesta
            if hasattr(response, 'IsValid') and not response.IsValid:
                print(f"\n❌ DOCUMENTO RECHAZADO POR LA DIAN")
                
                # 🆕 SIEMPRE guardar la validación DIAN aunque sea rechazada
                try:
                    validacion_json = guardar_validacion_dian(
                        nit=EMPRESA_NIT,
                        consecutivo=inv.invoice_ident,
                        response=response,
                        xml_file=xml_file,
                        zip_file=zip_file,
                        ambiente="produccion"
                    )
                    print(f"📋 Validación DIAN (rechazo) guardada: {validacion_json}")
                except Exception as val_error:
                    print(f"⚠️  Error guardando validación de rechazo: {val_error}")
                
                if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                    errors = response.ErrorMessage
                    if hasattr(errors, 'string'):
                        error_list = errors.string if isinstance(errors.string, list) else [errors.string]
                    else:
                        error_list = [errors] if isinstance(errors, str) else []
                    
                    if error_list:
                        es_duplicado = any(
                            bool(re.search(r'regla[:)]?\s*90|procesado\s+anteriormente', str(error), re.IGNORECASE))
                            for error in error_list
                        )
                        
                        if es_duplicado:
                            print(f"\n⚠️  Consecutivo {num_documento} ya procesado")
                            guardar_consecutivo(num_documento)
                            num_documento += 1
                            continue
                        else:
                            print(f"\n❌ ERRORES DE VALIDACIÓN:")
                            for i, error in enumerate(error_list, 1):
                                print(f"   {i}. {error}")
                            guardar_consecutivo(num_documento)
                            break
                break
            else:
                print("\n✅ ¡DOCUMENTO SOPORTE ACEPTADO EN PRODUCCIÓN!")
                documento_exitoso = True
                
                # Imprimir el CUDS/XmlDocumentKey de forma parseable para el api_server
                if hasattr(response, 'XmlDocumentKey') and response.XmlDocumentKey:
                    print(f"\nXmlDocumentKey: {response.XmlDocumentKey}")
                    print(f"CUDS: {response.XmlDocumentKey}")
                
                # 🆕 Guardar la validación DIAN como JSON (el "timbrado")
                try:
                    validacion_json = guardar_validacion_dian(
                        nit=EMPRESA_NIT,
                        consecutivo=inv.invoice_ident,
                        response=response,
                        xml_file=xml_file,
                        zip_file=zip_file,
                        ambiente="produccion"
                    )
                    print(f"📋 Timbrado DIAN guardado: {validacion_json}")
                except Exception as val_error:
                    print(f"⚠️  Error guardando validación: {val_error}")
                
                if hasattr(response, 'IsValid') and response.IsValid:
                    guardar_consecutivo(num_documento)
                    print(f"💾 Consecutivo guardado: {num_documento}")
                break
                
        except Exception as e:
            print("\n" + "="*80)
            print("❌ ERROR EN LA COMUNICACIÓN CON DIAN")
            print("="*80)
            print(f"Tipo de error: {type(e).__name__}")
            print(f"Mensaje: {str(e)}")
            import traceback
            traceback.print_exc()
            guardar_consecutivo(num_documento)
            break
        
        finally:
            print("\n📁 Archivos guardados:")
            print(f"   XML: {xml_file}")
            print(f"   ZIP: {zip_file}")
    
    print("\n" + "="*80)
    print("🔴 PRODUCCIÓN - DOCUMENTO SOPORTE:")
    print(f"   NIT Adquirente: {EMPRESA_NIT}-{EMPRESA_DV}")
    print(f"   Razón Social: {EMPRESA_RAZON_SOCIAL}")
    print(f"   Tipo DS: {TIPO_DOCUMENTO_SOPORTE}")
    print("="*80)

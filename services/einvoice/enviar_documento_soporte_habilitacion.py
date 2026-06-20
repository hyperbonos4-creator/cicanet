#!/usr/bin/env python3
"""
🚀 Script de envío de Documentos Soporte a DIAN - AMBIENTE HABILITACIÓN
✅ Configurado y validado para ambiente de habilitación (TestSet)
📋 Documento Soporte (Tipo 05) - Soporte DUAL para dos escenarios:
    1. BONO_CLIENTE: HSQ regala bonos a clientes (HSQ=proveedor, Cliente=adquirente)
    2. COMPRA_SNO: HSQ compra de personas no obligadas (SNO=proveedor, HSQ=adquirente)
📋 Lee configuración desde certificados/{NIT}/config_empresa.py y config_dian.py

⚙️ PARÁMETROS:
   - sys.argv[1]: NIT de la empresa
   - sys.argv[2]: Consecutivo específico (opcional)
   - sys.argv[3]: tipo_documento_soporte ('BONO_CLIENTE' o 'COMPRA_SNO') - NUEVO
   - sys.argv[4]: ruta al JSON con datos (cliente o proveedor_sno) - NUEVO

⚙️ CONFIGURACIÓN OPCIONAL en config_dian.py:
   - MAX_INTENTOS_ENVIO: Número máximo de reintentos (default: 20)
     Ejemplo: MAX_INTENTOS_ENVIO = 30

📌 NOTA IMPORTANTE - DSAJ25a (Anexo Técnico v1.1):
   Para vendedores RESIDENTES (CustomizationID='10'), el tipo de documento
   SIEMPRE debe ser NIT (31), incluso para personas naturales.
   El DV se calcula automáticamente a partir del número de cédula.
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
    
    Según Anexo Técnico 16.4.4 y DSAJ73:
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
        # Fallback: departamento + 0010
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

# Obtener NIT de la empresa (OBLIGATORIO - sin empresa por defecto)
if len(sys.argv) > 1:
    # El primer argumento SIEMPRE es el NIT cuando se llama desde la API
    # Puede tener cualquier longitud (ej: 051025 = 6 dígitos, 900565733 = 9 dígitos)
    EMPRESA_NIT = sys.argv[1]
    # Remover el NIT de sys.argv para que el resto del script funcione
    sys.argv.pop(1)
else:
    # NO HAY EMPRESA POR DEFECTO - debe proporcionarse siempre
    print('❌ ERROR CRÍTICO: No se proporcionó el NIT de la empresa')
    print('   Uso: python3 enviar_documento_soporte_habilitacion.py <NIT>')
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
import config_dian
importlib.reload(config_empresa)
importlib.reload(config_dian)

print('='*80)
print('📋 CONFIGURACIÓN COMPLETA CARGADA DESDE FRONTEND - DOCUMENTO SOPORTE')
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
print('\n🔐 CONFIGURACIÓN DIAN - SOFTWARE:')
print(f'   Software ID: {config_dian.SOFTWARE_ID}')
print(f'   PIN: {config_dian.PIN[:4]}***{config_dian.PIN[-4:] if len(config_dian.PIN) > 8 else "***"}')
print(f'   Clave Técnica: {config_dian.CLAVE_TECNICA[:8]}...{config_dian.CLAVE_TECNICA[-8:] if len(config_dian.CLAVE_TECNICA) > 16 else "***"}')
print(f'   Certificado Password: {"***" + config_dian.CERTIFICADO_PASSWORD[-4:] if len(config_dian.CERTIFICADO_PASSWORD) > 4 else "***"}')
print('\n📄 RESOLUCIÓN DOCUMENTO SOPORTE (Independiente de Facturación):')
print(f'   Número Resolución: {getattr(config_dian, "RESOLUCION_DS_NUMERO", "NO CONFIGURADO")}')
print(f'   Prefijo: {getattr(config_dian, "RESOLUCION_DS_PREFIJO", "NO CONFIGURADO")}')
print(f'   Rango Desde: {getattr(config_dian, "RESOLUCION_DS_NUMERO_DESDE", "NO CONFIGURADO")}')
print(f'   Rango Hasta: {getattr(config_dian, "RESOLUCION_DS_NUMERO_HASTA", "NO CONFIGURADO")}')
print(f'   Fecha Vigencia Desde: {getattr(config_dian, "RESOLUCION_DS_FECHA_DESDE", "NO CONFIGURADO")}')
print(f'   Fecha Vigencia Hasta: {getattr(config_dian, "RESOLUCION_DS_FECHA_HASTA", "NO CONFIGURADO")}')
print(f'   Test Set ID: {getattr(config_dian, "TEST_SET_ID_DS", "NO CONFIGURADO")}')
print('\n🌍 AMBIENTE:')
print(f'   Ambiente: HABILITACIÓN (Pruebas)')
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
# CONFIGURACIÓN EMPRESA (Igual para todos los documentos)
# ============================================================================
EMPRESA_NIT = config_empresa.EMPRESA_NIT
EMPRESA_DV = config_empresa.EMPRESA_DV
EMPRESA_RAZON_SOCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_NOMBRE_COMERCIAL = config_empresa.EMPRESA_RAZON_SOCIAL
EMPRESA_TIPO_ORGANIZACION = '1'  # Persona Jurídica
EMPRESA_REGIMEN = config_empresa.EMPRESA_REGIMEN
EMPRESA_RESPONSABILIDADES = config_empresa.EMPRESA_RESPONSABILIDADES

# Contraseña del certificado (desde config_dian.py)
CERTIFICADO_PASSWORD = config_dian.CERTIFICADO_PASSWORD

EMPRESA_CIUDAD_CODIGO = config_empresa.EMPRESA_CIUDAD_CODIGO
EMPRESA_CIUDAD_NOMBRE = config_empresa.EMPRESA_CIUDAD_NOMBRE
EMPRESA_DEPARTAMENTO_CODIGO = config_empresa.EMPRESA_DEPARTAMENTO_CODIGO
EMPRESA_DEPARTAMENTO_NOMBRE = config_empresa.EMPRESA_DEPARTAMENTO_NOMBRE
EMPRESA_PAIS = 'CO'
EMPRESA_DIRECCION = config_empresa.EMPRESA_DIRECCION
EMPRESA_EMAIL = config_empresa.EMPRESA_EMAIL

# ============================================================================
# SOFTWARE (Mismo ID para Factura y DS)
# ============================================================================
ID_SOFTWARE = config_dian.SOFTWARE_ID
PIN_SOFTWARE = config_dian.PIN
CLAVE_TECNICA = config_dian.CLAVE_TECNICA

# ============================================================================
# RESOLUCIÓN DOCUMENTO SOPORTE (Diferente a Factura Electrónica)
# ============================================================================
# IMPORTANTE: Estos datos son ESPECÍFICOS para Documento Soporte
# DEBEN estar configurados desde el frontend - NO hay valores por defecto
RESOLUCION_NUMERO = getattr(config_dian, 'RESOLUCION_DS_NUMERO', '')
RESOLUCION_FECHA_DESDE = getattr(config_dian, 'RESOLUCION_DS_FECHA_DESDE', None)
RESOLUCION_FECHA_HASTA = getattr(config_dian, 'RESOLUCION_DS_FECHA_HASTA', None)
RESOLUCION_PREFIJO = getattr(config_dian, 'RESOLUCION_DS_PREFIJO', '')
RESOLUCION_NUMERO_DESDE = getattr(config_dian, 'RESOLUCION_DS_NUMERO_DESDE', 0)
RESOLUCION_NUMERO_HASTA = getattr(config_dian, 'RESOLUCION_DS_NUMERO_HASTA', 0)

# TestSetId para ambiente de Habilitación DS
TEST_SET_ID = getattr(config_dian, 'TEST_SET_ID_DS', '')

# ============================================================================
# VALIDACIÓN DE CONFIGURACIÓN
# ============================================================================
print('='*80)
print('🔍 VALIDANDO CONFIGURACIÓN DE DOCUMENTO SOPORTE')
print('='*80)

# Verificar que todos los campos necesarios estén configurados
campos_requeridos = {
    'RESOLUCION_DS_NUMERO': RESOLUCION_NUMERO,
    'RESOLUCION_DS_PREFIJO': RESOLUCION_PREFIJO,
    'RESOLUCION_DS_NUMERO_DESDE': RESOLUCION_NUMERO_DESDE,
    'RESOLUCION_DS_NUMERO_HASTA': RESOLUCION_NUMERO_HASTA,
    'TEST_SET_ID_DS': TEST_SET_ID
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
    print('\n⚠️  Por favor, configura todos los campos desde el frontend antes de enviar.')
    print('   Ve a: Configuración > Resolución > DOCUMENTO SOPORTE')
    print('='*80)
    sys.exit(1)

print('='*80)
print('✅ CONFIGURACIÓN VÁLIDA - Procediendo con el envío')
print('='*80)

# ============================================================================
# PARÁMETROS ADICIONALES: TIPO DE DS Y DATOS DINÁMICOS
# ============================================================================
# Verificar si se recibió tipo_documento_soporte y JSON con datos
TIPO_DOCUMENTO_SOPORTE = None
DATOS_DINAMICOS = None
CONSECUTIVO_ESPECIFICO = None

# Analizar argumentos:
# NOTA: El NIT ya fue extraído y removido de sys.argv con pop(1)
# Por lo tanto los índices son:
# Caso 1: script.py (después de pop) → modo legacy
# Caso 2: script.py consecutivo (después de pop) → modo legacy con consecutivo
# Caso 3: script.py TIPO_DS JSON (después de pop) → modo dual sin consecutivo
# Caso 4: script.py consecutivo TIPO_DS JSON (después de pop) → modo dual con consecutivo

if len(sys.argv) >= 2:
    # Verificar si argv[1] es un tipo de DS o un consecutivo
    arg1 = sys.argv[1]
    
    if arg1 in ['BONO_CLIENTE', 'COMPRA_SNO']:
        # Caso 3: TIPO_DS JSON
        TIPO_DOCUMENTO_SOPORTE = arg1
        if len(sys.argv) >= 3:
            json_path = sys.argv[2]
            if os.path.exists(json_path):
                print(f'\n📋 Cargando datos dinámicos desde: {json_path}')
                with open(json_path, 'r', encoding='utf-8') as f:
                    DATOS_DINAMICOS = json.load(f)
                print(f'✅ Tipo de Documento Soporte: '
                      f'{TIPO_DOCUMENTO_SOPORTE}')
                if TIPO_DOCUMENTO_SOPORTE == 'BONO_CLIENTE':
                    cliente_nombre = DATOS_DINAMICOS.get(
                        "cliente", {}
                    ).get("nombres", "N/A")
                    print(f'   Cliente: {cliente_nombre}')
                else:
                    proveedor_nombre = DATOS_DINAMICOS.get(
                        "proveedor_sno", {}
                    ).get("nombres", "N/A")
                    print(f'   Proveedor SNO: {proveedor_nombre}')
            else:
                print(f'⚠️  Archivo JSON no encontrado: {json_path}')
    else:
        # Podría ser consecutivo, verificar si es numérico
        try:
            CONSECUTIVO_ESPECIFICO = int(arg1)
            # Es un consecutivo, ver si hay más parámetros
            if len(sys.argv) >= 3:
                arg2 = sys.argv[2]
                if arg2 in ['BONO_CLIENTE', 'COMPRA_SNO']:
                    # Caso 4: consecutivo TIPO_DS JSON
                    TIPO_DOCUMENTO_SOPORTE = arg2
                    if len(sys.argv) >= 4:
                        json_path = sys.argv[3]
                        if os.path.exists(json_path):
                            print(f'\n📋 Cargando datos dinámicos desde: '
                                  f'{json_path}')
                            with open(json_path, 'r', encoding='utf-8') as f:
                                DATOS_DINAMICOS = json.load(f)
                            print(f'✅ Tipo de Documento Soporte: '
                                  f'{TIPO_DOCUMENTO_SOPORTE}')
                            print(f'✅ Consecutivo específico: '
                                  f'{CONSECUTIVO_ESPECIFICO}')
                            if TIPO_DOCUMENTO_SOPORTE == 'BONO_CLIENTE':
                                cliente_nombre = DATOS_DINAMICOS.get(
                                    "cliente", {}
                                ).get("nombres", "N/A")
                                print(f'   Cliente: {cliente_nombre}')
                            else:
                                proveedor_nombre = DATOS_DINAMICOS.get(
                                    "proveedor_sno", {}
                                ).get("nombres", "N/A")
                                print(f'   Proveedor SNO: '
                                      f'{proveedor_nombre}')
                        else:
                            print(f'⚠️  Archivo JSON no encontrado: '
                                  f'{json_path}')
        except ValueError:
            # No es numérico ni tipo DS, ignorar
            pass

# Si no se especificó tipo, usar modo legacy (COMPRA_SNO con datos hardcoded)
if not TIPO_DOCUMENTO_SOPORTE:
    TIPO_DOCUMENTO_SOPORTE = 'COMPRA_SNO'
    print('\n⚠️  Modo legacy: usando COMPRA_SNO con datos hardcoded')

print('='*80)

AMBIENTE = fe.AMBIENTE_PRUEBAS

# Sistema de consecutivos para Documento Soporte
# Usar archivo específico de la empresa
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_soporte.txt'

# ============================================================================
# FUNCIÓN: EXTENSIONES DIAN
# ============================================================================
def extensions(inv):
    """
    Genera las extensiones XML requeridas por la DIAN para Documento Soporte
    """
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        ID_SOFTWARE, 
        PIN_SOFTWARE, 
        inv.invoice_ident
    )
    
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    # ✅ CORRECCIÓN CRÍTICA: Usar DianXMLExtensionCUDS en lugar de CUFE
    # Según Anexo Técnico v1.1 sección 14.1.1.1, el CUDS tiene una fórmula diferente:
    # CUDS = SHA-384(NumDS + FecDS + HorDS + ValDS + CodImp + ValImp + ValTot + NumSNO + NITABS + Software-PIN + TipoAmbiente)
    # Usa Software-PIN en lugar de Clave Técnica
    cuds = fe.DianXMLExtensionCUDS(
        inv, 
        PIN_SOFTWARE,  # Software-PIN (no Clave Técnica)
        AMBIENTE
    )
    
    # El Software Provider sigue siendo el Adquirente (quien genera el documento)
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
# FUNCIÓN: CREAR DOCUMENTO SOPORTE DE EJEMPLO
# ============================================================================
def support_document():
    """
    Crea un Documento Soporte con datos reales.
    NOTA IMPORTANTE:
    - Supplier (Vendedor) = No Obligado a Facturar (SNO)
    - Customer (Adquirente) = Nosotros (HSQ)
    """
    # Crear documento tipo 01 (igual que factura, el tipo '05' se establece en el XML)
    inv = form.Invoice('01')
    
    # Usar hora de Colombia (UTC-5) para todas las fechas del documento
    ahora_colombia = hora_colombia()
    
    # Periodo de facturación
    inv.set_period(ahora_colombia, ahora_colombia)
    
    # Fecha de emisión
    inv.set_issue(ahora_colombia)
    
    # Número de documento (Prefijo + consecutivo)
    # Se establecerá en el bucle principal
    
    # ========================================================================
    # TIPO DE OPERACIÓN: 10 = Residente, 11 = No Residente
    # Resolución 000227, Art. 1.5.2.2.3 (No residentes)
    # ========================================================================
    es_no_residente = False
    if DATOS_DINAMICOS:
        # Detectar no residente desde los datos del cliente o proveedor
        datos_persona = DATOS_DINAMICOS.get('cliente') or DATOS_DINAMICOS.get('proveedor_sno') or {}
        es_no_residente = datos_persona.get('es_residente') == False
    
    if es_no_residente:
        inv.set_operation_type('11')  # ★ CustomizationID=11 (No Residente)
        print(f'📋 CustomizationID=11 → NO RESIDENTE (Resolución 000227, Art. 1.5.2.2.3)')
    else:
        inv.set_operation_type('10')  # CustomizationID=10 (Residente)
        print(f'📋 CustomizationID=10 → RESIDENTE')
    
    # ========================================================================
    # EMISOR Y ADQUIRENTE - CONFIGURACIÓN DINÁMICA SEGÚN TIPO DE DS
    # ========================================================================
    
    if TIPO_DOCUMENTO_SOPORTE == 'BONO_CLIENTE':
        # ====================================================================
        # ESCENARIO 1: BONOS A CLIENTES
        # IMPORTANTE: En Documento Soporte UBL:
        #   - AccountingCustomerParty (set_customer) = Quien EMITE el documento
        #   - AccountingSupplierParty (set_supplier) = Contraparte
        # 
        # Por lo tanto para bonos:
        #   - HSQ = CUSTOMER (emisor autorizado del documento)
        #   - CLIENTE = SUPPLIER (contraparte que recibe el bono)
        # ====================================================================
        print(f'📦 Configurando DS para: BONO A CLIENTE')
        
        # HSQ como customer (EMISOR del documento)
        customer = form.Party(
            legal_name=EMPRESA_RAZON_SOCIAL,
            name=EMPRESA_NOMBRE_COMERCIAL,
            ident=form.PartyIdentification(
                EMPRESA_NIT, EMPRESA_DV, '31'
            ),
            responsability_code=form.Responsability(
                EMPRESA_RESPONSABILIDADES
            ),
            responsability_regime_code=EMPRESA_REGIMEN,
            organization_code=EMPRESA_TIPO_ORGANIZACION,
            email=EMPRESA_EMAIL,
            phone=getattr(config_empresa, 'EMPRESA_TELEFONO', '3001234567'),
            address=form.Address(
                name=EMPRESA_DIRECCION,
                street=EMPRESA_DIRECCION,
                city=form.City(
                    EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE
                ),
                country=form.Country(EMPRESA_PAIS, 'Colombia'),
                countrysubentity=form.CountrySubentity(
                    EMPRESA_DEPARTAMENTO_CODIGO,
                    EMPRESA_DEPARTAMENTO_NOMBRE
                ),
                # PostalZone: código postal de 6 dígitos (DSAJ73)
                postal_code=getattr(config_empresa, 'EMPRESA_CODIGO_POSTAL', 
                    generar_codigo_postal(EMPRESA_CIUDAD_CODIGO, EMPRESA_DEPARTAMENTO_CODIGO))
            )
        )
        inv.set_customer(customer)
        
        # Cliente como supplier (contraparte)
        # Según el Anexo Técnico v1.1:
        # - DSAJ25a: Residentes (CustomizationID=10) → SIEMPRE tipo 31 (NIT)
        # - DSAJ25b: No Residentes (CustomizationID=11) → tipo real (21,22,41,42,47,50)
        if DATOS_DINAMICOS and 'cliente' in DATOS_DINAMICOS:
            cliente = DATOS_DINAMICOS['cliente']
            
            # El número de documento del cliente
            numero_doc = cliente.get('numero_documento', '0')
            
            # ★ Determinar si es NO RESIDENTE
            cliente_es_residente = cliente.get('es_residente', True)
            
            if cliente_es_residente:
                # ============================================================
                # RESIDENTE: DSAJ25a → Forzar NIT (31) + DV calculado
                # ============================================================
                dv_calculado = calcular_dv_nit(numero_doc)
                tipo_documento_fiscal = '31'  # NIT obligatorio
                print(f'   📋 DSAJ25a: Convirtiendo documento a NIT (31) con DV={dv_calculado}')
                
                supplier = form.Party(
                    legal_name=f"{cliente.get('nombres', '')} "
                               f"{cliente.get('apellidos', '')}".strip(),
                    name=f"{cliente.get('nombres', '')} "
                         f"{cliente.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        dv_calculado,
                        tipo_documento_fiscal
                    ),
                    responsability_code=form.Responsability(['R-99-PN']),
                    responsability_regime_code='49',
                    organization_code='2',  # Persona Natural
                    email=cliente.get('email', ''),
                    phone=cliente.get('telefono', ''),
                    tax_scheme=form.TaxScheme('ZZ'),
                    address=form.Address(
                        name=cliente.get('direccion', 'N/A'),
                        street=cliente.get('direccion', 'N/A'),
                        city=form.City(
                            cliente.get('ciudad_codigo', '05001'),
                            obtener_nombre_municipio(
                                cliente.get('ciudad_codigo', '05001'),
                                cliente.get('ciudad_nombre', 'Medellín')
                            )
                        ),
                        country=form.Country(
                            cliente.get('pais', 'CO'), 'Colombia'
                        ),
                        countrysubentity=form.CountrySubentity(
                            cliente.get('departamento_codigo', '05'),
                            cliente.get('departamento_nombre', 'Antioquia')
                        ),
                        postal_code=cliente.get('codigo_postal', generar_codigo_postal(
                            cliente.get('ciudad_codigo', '05001'),
                            cliente.get('departamento_codigo', '05')
                        ))
                    )
                )
                inv.set_supplier(supplier)
                print(f'   Cliente RESIDENTE: {cliente.get("nombres")} '
                      f'{cliente.get("apellidos")} - '
                      f'{cliente.get("numero_documento")} (NIT:{numero_doc}-{dv_calculado})')
            else:
                # ============================================================
                # NO RESIDENTE: DSAJ25b → Tipo real + sin DV + dirección simple
                # Resolución 000227, Art. 1.5.2.2.3
                # ============================================================
                tipo_documento_fiscal = cliente.get('tipo_documento', '41')
                # ★ Sin DV para no residentes
                dv_no_residente = ''
                
                print(f'   📋 DSAJ25b: Usando documento real tipo={tipo_documento_fiscal}, '
                      f'número={numero_doc} (alfanumérico permitido)')
                
                # ★ Dirección simplificada: solo CityName + Country (DSAJ08b)
                # NO usar form.City (valida contra DIVIPOLA)
                # NO usar form.CountrySubentity (valida contra departamentos)
                supplier = form.Party(
                    legal_name=f"{cliente.get('nombres', '')} "
                               f"{cliente.get('apellidos', '')}".strip(),
                    name=f"{cliente.get('nombres', '')} "
                         f"{cliente.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        dv_no_residente,
                        tipo_documento_fiscal
                    ),
                    responsability_code=form.Responsability(['R-99-PN']),
                    responsability_regime_code='49',
                    organization_code=cliente.get('tipo_persona', '2'),  # 2=PN, 1=PJ
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
        else:
            # NO HAY FALLBACK - Los datos del cliente son OBLIGATORIOS
            raise ValueError(
                "❌ ERROR CRÍTICO: No se proporcionaron datos del cliente (beneficiario del bono). "
                "Los datos del cliente registrado son OBLIGATORIOS. "
                "No se permiten datos de prueba o inventados."
            )
    
    elif TIPO_DOCUMENTO_SOPORTE == 'COMPRA_SNO':
        # ====================================================================
        # ESCENARIO 2: COMPRAS A PROVEEDORES NO OBLIGADOS
        # EMISOR (SUPPLIER) = PROVEEDOR SNO (quien vendió)
        # ADQUIRENTE (CUSTOMER) = HSQ (quien compró)
        # ====================================================================
        print(f'📦 Configurando DS para: COMPRA A PROVEEDOR SNO')
        
        # Proveedor SNO como supplier
        # - DSAJ25a: Residentes → tipo 31 (NIT) + DV
        # - DSAJ25b: No Residentes → tipo real + sin DV
        if DATOS_DINAMICOS and 'proveedor_sno' in DATOS_DINAMICOS:
            proveedor = DATOS_DINAMICOS['proveedor_sno']
            
            # El número de documento del proveedor
            numero_doc = proveedor.get('numero_documento', '0')
            
            # ★ Determinar si es NO RESIDENTE
            prov_es_residente = proveedor.get('es_residente', True)
            
            if prov_es_residente:
                # RESIDENTE: DSAJ25a → NIT (31) + DV
                dv_calculado = calcular_dv_nit(numero_doc)
                tipo_documento_fiscal = '31'
                print(f'   📋 DSAJ25a: Convirtiendo documento a NIT (31) con DV={dv_calculado}')
                
                supplier = form.Party(
                    legal_name=f"{proveedor.get('nombres', '')} "
                               f"{proveedor.get('apellidos', '')}".strip(),
                    name=f"{proveedor.get('nombres', '')} "
                         f"{proveedor.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        dv_calculado,
                        tipo_documento_fiscal
                    ),
                    responsability_code=form.Responsability(['R-99-PN']),
                    responsability_regime_code='49',
                    organization_code='2',
                    email=proveedor.get('email', ''),
                    phone=proveedor.get('telefono', ''),
                    tax_scheme=form.TaxScheme('ZZ'),
                    address=form.Address(
                        name=proveedor.get('direccion', 'N/A'),
                        street=proveedor.get('direccion', 'N/A'),
                        city=form.City(
                            proveedor.get('ciudad_codigo', '05001'),
                            obtener_nombre_municipio(
                                proveedor.get('ciudad_codigo', '05001'),
                                proveedor.get('ciudad_nombre', 'Medellín')
                            )
                        ),
                        country=form.Country(
                            proveedor.get('pais', 'CO'), 'Colombia'
                        ),
                        countrysubentity=form.CountrySubentity(
                            proveedor.get('departamento_codigo', '05'),
                            proveedor.get('departamento_nombre', 'Antioquia')
                        ),
                        postal_code=proveedor.get('codigo_postal', generar_codigo_postal(
                            proveedor.get('ciudad_codigo', '05001'),
                            proveedor.get('departamento_codigo', '05')
                        ))
                    )
                )
                inv.set_supplier(supplier)
                print(f'   Proveedor RESIDENTE: {proveedor.get("nombres")} '
                      f'{proveedor.get("apellidos")} - NIT:{numero_doc}-{dv_calculado}')
            else:
                # NO RESIDENTE: DSAJ25b → tipo real + sin DV + dirección simple
                tipo_documento_fiscal = proveedor.get('tipo_documento', '42')
                print(f'   📋 DSAJ25b: Proveedor NO RESIDENTE tipo={tipo_documento_fiscal}, '
                      f'número={numero_doc}')
                
                supplier = form.Party(
                    legal_name=f"{proveedor.get('nombres', '')} "
                               f"{proveedor.get('apellidos', '')}".strip(),
                    name=f"{proveedor.get('nombres', '')} "
                         f"{proveedor.get('apellidos', '')}".strip(),
                    ident=form.PartyIdentification(
                        numero_doc,
                        '',  # Sin DV
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
                      f'Doc {tipo_documento_fiscal}: {numero_doc}')
        else:
            # NO HAY FALLBACK - Los datos del proveedor SNO son OBLIGATORIOS
            raise ValueError(
                "❌ ERROR CRÍTICO: No se proporcionaron datos del proveedor SNO. "
                "Los datos del proveedor registrado son OBLIGATORIOS. "
                "No se permiten datos de prueba o inventados."
            )
        
        # HSQ como customer (adquirente)
        customer = form.Party(
            legal_name=EMPRESA_RAZON_SOCIAL,
            name=EMPRESA_NOMBRE_COMERCIAL,
            ident=form.PartyIdentification(
                EMPRESA_NIT, EMPRESA_DV, '31'
            ),
            responsability_code=form.Responsability(
                EMPRESA_RESPONSABILIDADES
            ),
            responsability_regime_code=EMPRESA_REGIMEN,
            organization_code=EMPRESA_TIPO_ORGANIZACION,
            email=EMPRESA_EMAIL,
            phone=getattr(config_empresa, 'EMPRESA_TELEFONO', '3001234567'),
            address=form.Address(
                name=EMPRESA_DIRECCION,
                street=EMPRESA_DIRECCION,
                city=form.City(
                    EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE
                ),
                country=form.Country(EMPRESA_PAIS, 'Colombia'),
                countrysubentity=form.CountrySubentity(
                    EMPRESA_DEPARTAMENTO_CODIGO,
                    EMPRESA_DEPARTAMENTO_NOMBRE
                ),
                # PostalZone: código postal de 6 dígitos (DSAJ73)
                postal_code=getattr(config_empresa, 'EMPRESA_CODIGO_POSTAL', 
                    generar_codigo_postal(EMPRESA_CIUDAD_CODIGO, EMPRESA_DEPARTAMENTO_CODIGO))
            )
        )
        inv.set_customer(customer)
    
    else:
        raise ValueError(
            f'Tipo de Documento Soporte no reconocido: '
            f'{TIPO_DOCUMENTO_SOPORTE}'
        )
    
    # ========================================================================
    # MEDIO DE PAGO
    # ========================================================================
    inv.set_payment_mean(form.PaymentMean(
        id='1',
        code='10',  # Efectivo
        due_at=hora_colombia(),
        payment_id='1'
    ))
    
    # ========================================================================
    # LÍNEA DE DOCUMENTO: Servicio o Bien adquirido
    # ========================================================================
    # Obtener datos del bono si existen en DATOS_DINAMICOS
    if DATOS_DINAMICOS and 'bono' in DATOS_DINAMICOS:
        bono = DATOS_DINAMICOS['bono']
        cantidad = float(bono.get('cantidad', 1))
        unidad_medida = str(bono.get('unidad_medida', '94'))
        descripcion = bono.get('descripcion', bono.get('concepto_descripcion', 'BONO Y PREMIO'))
        codigo_unspsc = str(bono.get('concepto_unspsc', '82141505'))
        concepto_descripcion = bono.get('concepto_descripcion', 'Premios e incentivos')
        valor_unitario = float(bono.get('valor_unitario', bono.get('valor_total', 0)))
        
        print(f'\n📦 Usando datos del BONO:')
        print(f'   Cantidad: {cantidad}')
        print(f'   Descripción: {descripcion}')
        print(f'   UNSPSC: {codigo_unspsc} - {concepto_descripcion}')
        print(f'   Valor Unitario: ${valor_unitario:,.2f}')
    else:
        # Valores por defecto (fallback)
        cantidad = 1.0
        unidad_medida = '94'
        descripcion = 'Servicios de Mantenimiento'
        codigo_unspsc = '80141600'
        concepto_descripcion = 'Servicios de mantenimiento y soporte'
        valor_unitario = 150000.00
        print(f'\n⚠️  Sin datos de bono, usando valores por defecto: ${valor_unitario:,.2f}')
    
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


# ============================================================================
# FUNCIÓN: TIPO DE DOCUMENTO XML
# ============================================================================
def document_xml():
    """Retorna la clase para generar el XML de Documento Soporte"""
    return form_xml.DIANSupportDocumentXML


# ============================================================================
# MAIN: Envío a DIAN
# ============================================================================
if __name__ == '__main__':
    def obtener_consecutivo(num_especifico=None):
        if num_especifico:
            num = int(num_especifico)
            if RESOLUCION_NUMERO_DESDE <= num <= RESOLUCION_NUMERO_HASTA:
                return num
            # Si está fuera del rango, empezar desde el inicio del rango
            print(f'⚠️  Número {num} fuera del rango autorizado '
                  f'({RESOLUCION_NUMERO_DESDE}-{RESOLUCION_NUMERO_HASTA})')
            print(f'⚠️  Iniciando desde el inicio del rango: '
                  f'{RESOLUCION_NUMERO_DESDE}')
            return RESOLUCION_NUMERO_DESDE
        
        if os.path.exists(CONSECUTIVO_FILE):
            with open(CONSECUTIVO_FILE, 'r') as f:
                ultimo_usado = int(f.read().strip())
                # Verificar si el consecutivo guardado está dentro del rango
                if ultimo_usado < RESOLUCION_NUMERO_DESDE:
                    # Consecutivo guardado es MENOR que el inicio del rango
                    # Significa que el rango cambió, empezar desde el nuevo inicio
                    print(f'⚠️  Consecutivo guardado ({ultimo_usado}) está '
                          f'ANTES del rango actual '
                          f'({RESOLUCION_NUMERO_DESDE}-{RESOLUCION_NUMERO_HASTA})')
                    print(f'⚠️  Iniciando desde el nuevo rango: '
                          f'{RESOLUCION_NUMERO_DESDE}')
                    return RESOLUCION_NUMERO_DESDE
                elif ultimo_usado > RESOLUCION_NUMERO_HASTA:
                    # Consecutivo guardado es MAYOR que el fin del rango
                    # Esto no debería pasar, pero por seguridad empezar desde inicio
                    print(f'⚠️  Consecutivo guardado ({ultimo_usado}) está '
                          f'DESPUÉS del rango actual '
                          f'({RESOLUCION_NUMERO_DESDE}-{RESOLUCION_NUMERO_HASTA})')
                    print(f'⚠️  Iniciando desde el inicio del rango: '
                          f'{RESOLUCION_NUMERO_DESDE}')
                    return RESOLUCION_NUMERO_DESDE
                else:
                    # Consecutivo dentro del rango, retornar el siguiente
                    siguiente = ultimo_usado + 1
                    if siguiente > RESOLUCION_NUMERO_HASTA:
                        raise ValueError(f'Se ha excedido el rango de '
                                         f'consecutivos autorizado. Último: '
                                         f'{RESOLUCION_NUMERO_HASTA}')
                    return siguiente
        return RESOLUCION_NUMERO_DESDE
    
    def guardar_consecutivo(num):
        with open(CONSECUTIVO_FILE, 'w') as f:
            f.write(str(num))
    
    def guardar_validacion_dian(nit, consecutivo, response, xml_file=None, zip_file=None, ambiente="habilitacion"):
        """
        Guarda la respuesta de validación de la DIAN como un archivo JSON (el "timbrado").
        """
        from datetime import datetime
        
        # Directorio de documentos
        docs_dir = Path(__file__).parent / "certificados" / str(nit) / "documentos"
        docs_dir.mkdir(parents=True, exist_ok=True)
        
        validacion = {
            "documento": {
                "consecutivo": consecutivo,
                "tipo": "DocumentoSoporte",
                "ambiente": ambiente,
                "nit_empresa": nit
            },
            "validacion_dian": {
                "fecha_validacion": datetime.now().isoformat(),
                "XmlDocumentKey": None,
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
                "validacion_json": None
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
        
        if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
            errors = response.ErrorMessage
            if hasattr(errors, 'string'):
                error_list = errors.string if isinstance(errors.string, list) else [errors.string]
            else:
                error_list = [str(errors)] if errors else []
            validacion["validacion_dian"]["ErrorMessage"] = error_list
        
        # Nombre del archivo JSON
        json_filename = f"ds_habi_validacion_{consecutivo}.json"
        json_path = docs_dir / json_filename
        validacion["archivos"]["validacion_json"] = str(json_path)
        
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(validacion, f, ensure_ascii=False, indent=2, default=str)
        
        print(f"📋 Validación DIAN guardada: {json_path}")
        return str(json_path)
    
    # Obtener número inicial
    if CONSECUTIVO_ESPECIFICO:
        num_doc_inicial = obtener_consecutivo(CONSECUTIVO_ESPECIFICO)
        print(f'ℹ️  Usando número especificado: {num_doc_inicial}')
    else:
        num_doc_inicial = obtener_consecutivo()
        print(f'ℹ️  Usando siguiente consecutivo: {num_doc_inicial}')
    
    # Bucle de reintento automático
    # IMPORTANTE: Intentar hasta MAX_INTENTOS si son rechazados
    # DETENERSE INMEDIATAMENTE si uno es AUTORIZADO
    # Máximo de intentos: configurable desde config_dian o valor por defecto
    MAX_INTENTOS = getattr(config_dian, 'MAX_INTENTOS_ENVIO', 20)
    num_doc = num_doc_inicial
    intento = 0
    
    while intento < MAX_INTENTOS:
        intento += 1
        if intento > 1:
            print(f"\n🔄 Reintento {intento}/{MAX_INTENTOS} con consecutivo: {num_doc}")
            print(f"   Motivo: El documento anterior fue RECHAZADO por la DIAN")
            print(f"   Intentando con el siguiente consecutivo...")
        
        print("="*80)
        print(f"📋 ENVIANDO DOCUMENTO SOPORTE {RESOLUCION_PREFIJO}{num_doc} A DIAN HABILITACIÓN")
        print("="*80)
        
        # Generar documento
        inv = support_document()
        inv.set_ident(f'{RESOLUCION_PREFIJO}{num_doc}')
        inv.calculate()
        
        print(f"\n✅ Documento generado: {inv.invoice_ident}")
        print(f"   Adquirente (Emisor XML): {EMPRESA_RAZON_SOCIAL}")
        print(f"   Vendedor (Proveedor): {inv.invoice_supplier.legal_name}")
        print(f"   Total: ${inv.invoice_legal_monetary_total.payable_amount.float():,.2f}")
        
        print('\n📊 DATOS QUE SE ENVIARÁN EN EL XML (DOCUMENTO SOPORTE):')
        print(f'   Consecutivo Completo: {inv.invoice_ident}')
        print(f'   Prefijo Usado: {RESOLUCION_PREFIJO}')
        print(f'   Número: {num_doc}')
        print(f'   Resolución: {RESOLUCION_NUMERO}')
        print(f'   Rango Autorizado: {RESOLUCION_NUMERO_DESDE} - {RESOLUCION_NUMERO_HASTA}')
        print(f'   Vigencia: {RESOLUCION_FECHA_DESDE} a {RESOLUCION_FECHA_HASTA}')
        print(f'   Software ID: {ID_SOFTWARE}')
        print(f'   PIN Software: {PIN_SOFTWARE[:4]}***{PIN_SOFTWARE[-4:]}')
        print(f'   Test Set ID: {TEST_SET_ID}')
        print(f'   Ambiente: HABILITACIÓN')
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        # Ya no es necesario cambiar manualmente el schemeName
        # La clase DianXMLExtensionCUDS ya genera "CUDS-SHA384" correctamente

        xml_file = f'/tmp/ds_{inv.invoice_ident}_firmada.xml'
        # Usar certificado de la carpeta específica de la empresa
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f"✅ XML firmado con certificado de {EMPRESA_NIT}: {xml_file}")
        
        # Crear ZIP
        zip_file = f'/tmp/ds_{inv.invoice_ident}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'ds_{inv.invoice_ident}.xml')
        print(f"✅ ZIP creado: {zip_file}")
        
        # Enviar a DIAN
        print("\n📤 Enviando a DIAN Habilitación...")
        print("="*80)
        
        # Usar certificados PEM de la carpeta específica de la empresa
        key_pem_path = f'certificados/{EMPRESA_NIT}/llave_firma.pem'
        cert_pem_path = f'certificados/{EMPRESA_NIT}/certificado_firma.pem'
        client = dian.DianSignatureClient(key_pem_path, cert_pem_path, password=None)
        
        with open(zip_file, 'rb') as f:
            zip_content = f.read()
        
        zip_base64 = base64.b64encode(zip_content).decode('utf-8')
        
        es_duplicado = False
        doc_exitoso = False
        
        try:
            # Para Documento Soporte también se usa SendBillSync
            response = client.request(dian.Habilitacion.SendBillSync(f'ds_{inv.invoice_ident}.zip', zip_base64))
            
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
            
            # ================================================================
            # PROCESAMIENTO DE RESPUESTA DIAN
            # ================================================================
            
            # Verificar primero si el documento fue rechazado por IsValid=False
            if hasattr(response, 'IsValid') and not response.IsValid:
                print(f"\n❌ DOCUMENTO RECHAZADO POR LA DIAN")
                print(f"📝 Razón: {getattr(response, 'StatusDescription', 'Sin descripción')}")
                print(f"📊 Código: {getattr(response, 'StatusCode', 'Sin código')}")
                
                # Procesar errores si existen (sin duplicar lógica)
                if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                    errors = response.ErrorMessage
                    if hasattr(errors, 'string'):
                        error_list = errors.string if isinstance(errors.string, list) else [errors.string]
                    else:
                        error_list = [errors] if isinstance(errors, str) else []
                    
                    if error_list:
                        # Detectar si es documento duplicado
                        es_duplicado = any(
                            bool(re.search(r'regla[:)]?\s*90|procesado\s+anteriormente|documento\s+procesado|\[90\]',
                                          str(error), re.IGNORECASE))
                            for error in error_list
                        )
                        
                        if es_duplicado:
                            print(f"\n⚠️  Consecutivo {num_doc} ya procesado anteriormente")
                            guardar_consecutivo(num_doc)
                            print(f"💾 Consecutivo {num_doc} marcado como usado")
                            print(f"   Próximo consecutivo: {num_doc + 1}")
                            # Incrementar y continuar con siguiente consecutivo
                            num_doc += 1
                            continue
                        else:
                            # ERROR DE VALIDACIÓN (no duplicado) - NO reintentar
                            # Mostrar errores detallados
                            print(f"\n❌ TOTAL DE ERRORES: {len(error_list)}")
                            print("="*80)
                            print("\n📝 DETALLE DE ERRORES:")
                            print("-"*80)
                            for i, error in enumerate(error_list, 1):
                                print(f"{i:3d}. {error}")
                            # Guardar consecutivo (DIAN lo marca como enviado)
                            guardar_consecutivo(num_doc)
                            print(f"💾 Consecutivo {num_doc} guardado (rechazado - no reutilizable)")
                            print(f"   Próximo consecutivo: {num_doc + 1}")
                            # NO reintentar - salir del bucle
                            # Los errores de validación no se resuelven reintentando
                            break
                
                # Si IsValid=False pero no hay ErrorMessage, salir del bucle
                break
            
            # Si IsValid=True o no existe, procesar como éxito con notificaciones
            if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                errors = response.ErrorMessage
                if hasattr(errors, 'string'):
                    error_list = errors.string if isinstance(
                        errors.string, list) else [errors.string]
                else:
                    error_list = [errors] if isinstance(errors, str) else []
                
                if error_list:
                    # Detectar si es documento duplicado (optimizado con regex)
                    es_duplicado = any(
                        bool(re.search(
                            r'regla[:)]?\s*90|procesado\s+anteriormente',
                            str(error), re.IGNORECASE))
                        for error in error_list
                    )
                    
                    if es_duplicado:
                        print(f"\n⚠️  Consecutivo {num_doc} ya procesado")
                        # Guardar el consecutivo usado
                        guardar_consecutivo(num_doc)
                        print(f"💾 Consecutivo {num_doc} marcado como usado")
                        print(f"   Próximo consecutivo: {num_doc + 1}")
                        # Incrementar consecutivo y reintentar
                        num_doc += 1
                        continue  # Solo reintentar para duplicados
                    else:
                        print(f"\n❌ TOTAL DE ERRORES: {len(error_list)}")
                        print("="*80)
                        print("\n📝 DETALLE DE ERRORES:")
                        print("-"*80)
                        for i, error in enumerate(error_list, 1):
                            print(f"{i:3d}. {error}")
                        # Guardar consecutivo - DIAN lo marca como enviado
                        guardar_consecutivo(num_doc)
                        print(f"💾 Consecutivo {num_doc} guardado (rechazado)")
                        print(f"   Próximo consecutivo: {num_doc + 1}")
                        # NO reintentar errores de validación - salir
                        break
                else:
                    print("\n✅ ¡DOCUMENTO ACEPTADO SIN ERRORES!")
                    doc_exitoso = True
                    # 🆕 Guardar la validación DIAN como JSON
                    try:
                        guardar_validacion_dian(
                            nit=EMPRESA_NIT,
                            consecutivo=inv.invoice_ident,
                            response=response,
                            xml_file=xml_file,
                            zip_file=zip_file,
                            ambiente="habilitacion"
                        )
                    except Exception as val_error:
                        print(f"⚠️  Error guardando validación: {val_error}")
                    if hasattr(response, 'IsValid') and response.IsValid:
                        guardar_consecutivo(num_doc)
                        print(f"💾 Consecutivo guardado: {num_doc}")
                        print(f"   Próximo consecutivo: {num_doc + 1}")
                    break
            else:
                print("\n✅ ¡DOCUMENTO ACEPTADO SIN ERRORES!")
                doc_exitoso = True
                # 🆕 Guardar la validación DIAN como JSON
                try:
                    guardar_validacion_dian(
                        nit=EMPRESA_NIT,
                        consecutivo=inv.invoice_ident,
                        response=response,
                        xml_file=xml_file,
                        zip_file=zip_file,
                        ambiente="habilitacion"
                    )
                except Exception as val_error:
                    print(f"⚠️  Error guardando validación: {val_error}")
                if hasattr(response, 'IsValid') and response.IsValid:
                    guardar_consecutivo(num_doc)
                    print(f"💾 Consecutivo guardado: {num_doc}")
                    print(f"   Próximo consecutivo: {num_doc + 1}")
                break
                
        except Exception as e:
            print("\n" + "="*80)
            print("❌ ERROR EN LA COMUNICACIÓN CON DIAN")
            print("="*80)
            print(f"Tipo de error: {type(e).__name__}")
            print(f"Mensaje: {str(e)}")
            print(f"Consecutivo afectado: {num_doc}")
            print("\n📋 Stack Trace:")
            print("-"*80)
            import traceback
            traceback.print_exc()
            print("-"*80)
            
            # Guardar consecutivo por seguridad
            # Si se envió pero hubo error en respuesta, DIAN pudo recibirlo
            guardar_consecutivo(num_doc)
            print(f"\n💾 Consecutivo {num_doc} guardado por seguridad")
            print("   Razón: Error de comunicación - no se puede reutilizar")
            print(f"   Próximo consecutivo: {num_doc + 1}")
            
            # NO reintentar en errores de comunicación
            # El usuario debe verificar el estado y reintentar manualmente
            break
        
        finally:
            print("\n📁 Archivos guardados:")
            print(f"   XML: {xml_file}")
            print(f"   ZIP: {zip_file}")
    
    if intento >= MAX_INTENTOS and not doc_exitoso:
        print(f"\n⚠️  Se alcanzó el máximo de intentos ({MAX_INTENTOS}) "
              "sin éxito.")
        print(f"   Último consecutivo intentado: {num_doc}")
        print("   Todos los consecutivos intentados fueron guardados "
              "como enviados")
    
    # ========================================================================
    # LIMPIEZA: Eliminar archivo JSON temporal si existe
    # ========================================================================
    if DATOS_DINAMICOS:
        # Buscar el JSON en los argumentos
        for arg in sys.argv:
            if arg.endswith('.json') and os.path.exists(arg):
                try:
                    os.remove(arg)
                    print(f"\n🗑️  Archivo temporal eliminado: {arg}")
                except Exception as e:
                    print(f"\n⚠️  No se pudo eliminar archivo temporal: "
                          f"{e}")

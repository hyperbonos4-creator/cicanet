#!/usr/bin/env python3
"""
🚀 Script de envío de Facturas Electrónicas a DIAN - AMBIENTE HABILITACIÓN
✅ Configurado y validado para ambiente de habilitación (TestSet)
📋 Lee configuración desde certificados/{NIT}/config_empresa.py y config_dian.py

⚙️ CONFIGURACIÓN OPCIONAL en config_dian.py:
   - MAX_INTENTOS_ENVIO: Número máximo de reintentos (default: 20)
     Ejemplo: MAX_INTENTOS_ENVIO = 30
"""
import sys
import os
import re
from pathlib import Path

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
    print('   Uso: python3 enviar_factura_habilitacion.py <NIT> <consecutivo>')
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
print('📋 CONFIGURACIÓN COMPLETA CARGADA DESDE FRONTEND - FACTURA ELECTRÓNICA')
print('='*80)
print('\n🏢 DATOS DE LA EMPRESA:')
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
print('\n📄 RESOLUCIÓN DE FACTURACIÓN:')
print(f'   Número Resolución: {config_dian.RESOLUCION_NUMERO}')
print(f'   Prefijo: {config_dian.PREFIJO}')
print(f'   Rango Desde: {config_dian.RANGO_DESDE}')
print(f'   Rango Hasta: {config_dian.RANGO_HASTA}')
print(f'   Fecha Vigencia Desde: {config_dian.RESOLUCION_FECHA_DESDE}')
print(f'   Fecha Vigencia Hasta: {config_dian.RESOLUCION_FECHA_HASTA}')
print(f'   Test Set ID: {getattr(config_dian, "TEST_SET_ID", "N/A")}')
print('\n🌍 AMBIENTE:')
print(f'   Ambiente: HABILITACIÓN (Pruebas)')
print('='*80 + '\n')

from facho.fe import form, form_xml, fe
from facho.fe.client import dian
from datetime import datetime
import zipfile
import base64

# Usar valores del frontend
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

ID_SOFTWARE = config_dian.SOFTWARE_ID
PIN_SOFTWARE = config_dian.PIN
CLAVE_TECNICA = config_dian.CLAVE_TECNICA

RESOLUCION_NUMERO = config_dian.RESOLUCION_NUMERO
RESOLUCION_FECHA_DESDE = config_dian.RESOLUCION_FECHA_DESDE
RESOLUCION_FECHA_HASTA = config_dian.RESOLUCION_FECHA_HASTA
RESOLUCION_PREFIJO = config_dian.PREFIJO
RESOLUCION_NUMERO_DESDE = config_dian.RANGO_DESDE
RESOLUCION_NUMERO_HASTA = config_dian.RANGO_HASTA

# ============================================================================
# VALIDACIÓN DE CONFIGURACIÓN DE FACTURA ELECTRÓNICA
# ============================================================================
print('='*80)
print('🔍 VALIDANDO CONFIGURACIÓN DE FACTURA ELECTRÓNICA')
print('='*80)

campos_requeridos = {
    'RESOLUCION_NUMERO': RESOLUCION_NUMERO,
    'PREFIJO': RESOLUCION_PREFIJO,
    'RANGO_DESDE': RESOLUCION_NUMERO_DESDE,
    'RANGO_HASTA': RESOLUCION_NUMERO_HASTA,
    'SOFTWARE_ID': ID_SOFTWARE,
    'PIN': PIN_SOFTWARE,
    'CLAVE_TECNICA': CLAVE_TECNICA,
    'TEST_SET_ID': getattr(config_dian, 'TEST_SET_ID', '')
}

campos_vacios = []
for campo, valor in campos_requeridos.items():
    if not valor or valor == '' or valor == 0:
        campos_vacios.append(campo)
        print(f'❌ {campo}: NO CONFIGURADO')
    else:
        valor_mostrar = valor if campo not in ['PIN', 'CLAVE_TECNICA'] else f'{str(valor)[:4]}***'
        print(f'✅ {campo}: {valor_mostrar}')

if campos_vacios:
    print('='*80)
    print('❌ ERROR: CONFIGURACIÓN INCOMPLETA')
    print('='*80)
    print('Los siguientes campos de Factura Electrónica no están configurados:')
    for campo in campos_vacios:
        print(f'  - {campo}')
    print('\n⚠️  Por favor, configura todos los campos desde el frontend.')
    print('   Ve a: Configuración > Software DIAN / Resolución')
    print('='*80)
    sys.exit(1)

print('='*80)
print('✅ CONFIGURACIÓN VÁLIDA - Procediendo con el envío')
print('='*80 + '\n')

AMBIENTE = fe.AMBIENTE_PRUEBAS

# Sistema de consecutivos - AHORA POR EMPRESA
# Cada empresa tiene su propio archivo de control en su carpeta
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_factura.txt'

# ============================================================================
# FUNCIÓN: EXTENSIONES DIAN
# ============================================================================
def extensions(inv):
    """
    Genera las extensiones XML requeridas por la DIAN
    Ahora usa los datos REALES de la empresa
    """
    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        ID_SOFTWARE, 
        PIN_SOFTWARE, 
        inv.invoice_ident
    )
    
    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()
    
    cufe = fe.DianXMLExtensionCUFE(
        inv, 
        CLAVE_TECNICA, 
        AMBIENTE
    )
    
    # ✅ CORRECCIÓN APLICADA: Ahora usa NIT y DV reales, no literales
    software_provider = fe.DianXMLExtensionSoftwareProvider(
        EMPRESA_NIT,      # '900565733'
        EMPRESA_DV,       # '1'
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
    
    return [security_code, authorization_provider, cufe, software_provider, inv_authorization]


# ============================================================================
# FUNCIÓN: CREAR FACTURA DE EJEMPLO
# ============================================================================
def invoice():
    """
    Crea una factura de ejemplo con datos reales de HSQ INVERSIONES S.A.S.
    """
    # Crear factura tipo 01 (Factura de Venta)
    inv = form.Invoice('01')
    
    # Periodo de facturación
    inv.set_period(datetime.now(), datetime.now())
    
    # Fecha de emisión
    inv.set_issue(datetime.now())
    
    # Número de factura (SETP + consecutivo)
    inv.set_ident('SETP990000020')  # Incrementar según corresponda
    
    # Tipo de operación: 10 = Estándar
    inv.set_operation_type('10')
    
    # ========================================================================
    # EMISOR: HSQ INVERSIONES S.A.S.
    # ========================================================================
    supplier = form.Party(
        legal_name=EMPRESA_RAZON_SOCIAL,
        name=EMPRESA_NOMBRE_COMERCIAL,
        ident=form.PartyIdentification(EMPRESA_NIT, EMPRESA_DV, '31'),
        responsability_code=form.Responsability(EMPRESA_RESPONSABILIDADES),
        responsability_regime_code=EMPRESA_REGIMEN,
        organization_code=EMPRESA_TIPO_ORGANIZACION,
        email=EMPRESA_EMAIL,
        phone='3001234567',  # Teléfono de contacto (OBLIGATORIO según Anexo)
        address=form.Address(
            name=EMPRESA_DIRECCION,
            street=EMPRESA_DIRECCION,
            city=form.City(EMPRESA_CIUDAD_CODIGO, EMPRESA_CIUDAD_NOMBRE),
            country=form.Country(EMPRESA_PAIS, 'Colombia'),
            countrysubentity=form.CountrySubentity(
                EMPRESA_DEPARTAMENTO_CODIGO, 
                EMPRESA_DEPARTAMENTO_NOMBRE
            )
        )
    )
    inv.set_supplier(supplier)
    
    # ========================================================================
    # ADQUIRENTE: Cliente de Prueba (desde config_dian.py)
    # ========================================================================
    # Usar datos configurados desde el frontend, o valores por defecto
    cliente_tipo_persona = getattr(config_dian, 'CLIENTE_TIPO_PERSONA', '2')
    cliente_tipo_documento = getattr(config_dian, 'CLIENTE_TIPO_DOCUMENTO', '13')
    cliente_numero_documento = getattr(config_dian, 'CLIENTE_NUMERO_DOCUMENTO', '222222222222')
    cliente_dv = getattr(config_dian, 'CLIENTE_DV', '')
    cliente_razon_social = getattr(config_dian, 'CLIENTE_RAZON_SOCIAL', 'CLIENTE DE PRUEBA')
    cliente_nombre_comercial = getattr(config_dian, 'CLIENTE_NOMBRE_COMERCIAL', cliente_razon_social)
    cliente_email = getattr(config_dian, 'CLIENTE_EMAIL', 'cliente@ejemplo.com')
    cliente_direccion = getattr(config_dian, 'CLIENTE_DIRECCION', 'Dirección del cliente')
    cliente_codigo_municipio = getattr(config_dian, 'CLIENTE_CODIGO_MUNICIPIO', '05001')
    cliente_municipio = getattr(config_dian, 'CLIENTE_MUNICIPIO', 'Medellín')
    cliente_codigo_departamento = getattr(config_dian, 'CLIENTE_CODIGO_DEPARTAMENTO', '05')
    cliente_departamento = getattr(config_dian, 'CLIENTE_DEPARTAMENTO', 'Antioquia')
    cliente_codigo_pais = getattr(config_dian, 'CLIENTE_CODIGO_PAIS', 'CO')
    cliente_pais = getattr(config_dian, 'CLIENTE_PAIS', 'Colombia')
    cliente_regimen = getattr(config_dian, 'CLIENTE_REGIMEN', '49')
    cliente_responsabilidades = getattr(config_dian, 'CLIENTE_RESPONSABILIDADES', ['R-99-PN'])
    
    print(f'\n📋 CLIENTE DE PRUEBA (desde configuración):')
    print(f'   Razón Social: {cliente_razon_social}')
    print(f'   Documento: {cliente_tipo_documento}-{cliente_numero_documento}')
    print(f'   Email: {cliente_email}')
    print(f'   Dirección: {cliente_direccion}, {cliente_municipio}')
    
    customer = form.Party(
        legal_name=cliente_razon_social,
        name=cliente_nombre_comercial or cliente_razon_social,
        ident=form.PartyIdentification(cliente_numero_documento, cliente_dv, cliente_tipo_documento),
        responsability_code=form.Responsability(cliente_responsabilidades),
        responsability_regime_code=cliente_regimen,
        organization_code=cliente_tipo_persona,
        email=cliente_email,
        address=form.Address(
            name=cliente_direccion,
            street=cliente_direccion,
            city=form.City(cliente_codigo_municipio, cliente_municipio),
            country=form.Country(cliente_codigo_pais, cliente_pais),
            countrysubentity=form.CountrySubentity(cliente_codigo_departamento, cliente_departamento)
        )
    )
    inv.set_customer(customer)
    
    # ========================================================================
    # MEDIO DE PAGO
    # ========================================================================
    inv.set_payment_mean(form.PaymentMean(
        id='1',
        code='10',  # Efectivo
        due_at=datetime.now(),
        payment_id='1'
    ))
    
    # ========================================================================
    # LÍNEA DE FACTURA: Producto de ejemplo
    # ========================================================================
    inv.add_invoice_line(form.InvoiceLine(
        quantity=form.Quantity(1.0, '94'),  # 1 unidad
        description='Producto de prueba',
        item=form.StandardItem('PROD001', 9999),
        price=form.Price(
            amount=form.Amount(200000.00),  # $200,000 COP
            type_code='01',
            type='x'
        ),
        tax=form.TaxTotal(
            subtotals=[
                form.TaxSubTotal(
                    percent=19.00,  # IVA 19%
                    scheme=form.TaxScheme('01')
                )
            ]
        )
    ))
    
    return inv


# ============================================================================
# FUNCIÓN: TIPO DE DOCUMENTO XML
# ============================================================================
def document_xml():
    """Retorna la clase para generar el XML de factura"""
    return form_xml.DIANInvoiceXML


# ============================================================================
# MAIN: Envío a DIAN con configuración del frontend
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
    
    # Obtener número de factura inicial
    # sys.argv[1] = NIT, sys.argv[2] = consecutivo (si se proporciona)
    if len(sys.argv) > 2:
        num_factura_inicial = obtener_consecutivo(sys.argv[2])
        print(f'ℹ️  Usando número especificado como base: {num_factura_inicial}')
    else:
        num_factura_inicial = obtener_consecutivo()
        print(f'ℹ️  Usando siguiente consecutivo: {num_factura_inicial}')
    
    # Bucle de reintento automático para documentos duplicados
    # Máximo de intentos: configurable desde config_dian o valor por defecto
    MAX_INTENTOS = getattr(config_dian, 'MAX_INTENTOS_ENVIO', 20)
    num_factura = num_factura_inicial
    intento = 0
    
    while intento < MAX_INTENTOS:
        intento += 1
        if intento > 1:
            print(f"\n🔄 Reintento {intento}/{MAX_INTENTOS} con consecutivo: {num_factura}")
        
        print("="*80)
        print(f"📋 ENVIANDO FACTURA {RESOLUCION_PREFIJO}{num_factura} A DIAN HABILITACIÓN")
        print("="*80)
        
        # Generar factura
        inv = invoice()
        inv.set_ident(f'{RESOLUCION_PREFIJO}{num_factura}')  # Actualizar número
        inv.calculate()
        
        print(f"\n✅ Factura generada: {inv.invoice_ident}")
        print(f"   Emisor: {EMPRESA_RAZON_SOCIAL} (NIT {EMPRESA_NIT}-{EMPRESA_DV})")
        print(f"   Total: ${inv.invoice_legal_monetary_total.payable_amount.float():,.2f}")
        
        print('\n📊 DATOS QUE SE ENVIARÁN EN EL XML:')
        print(f'   Consecutivo Completo: {inv.invoice_ident}')
        print(f'   Prefijo Usado: {RESOLUCION_PREFIJO}')
        print(f'   Número: {num_factura}')
        print(f'   Resolución: {RESOLUCION_NUMERO}')
        print(f'   Rango Autorizado: {RESOLUCION_NUMERO_DESDE} - {RESOLUCION_NUMERO_HASTA}')
        print(f'   Vigencia: {RESOLUCION_FECHA_DESDE} a {RESOLUCION_FECHA_HASTA}')
        print(f'   Software ID: {ID_SOFTWARE}')
        print(f'   Clave Técnica: {CLAVE_TECNICA[:8]}...{CLAVE_TECNICA[-8:]}')
        print(f'   Ambiente: HABILITACIÓN')
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        # Firmar XML
        xml_file = f'/tmp/factura_{inv.invoice_ident}_firmada.xml'
        # Usar certificado de la carpeta específica de la empresa
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f"✅ XML firmado con certificado de {EMPRESA_NIT}: {xml_file}")
        
        # Crear ZIP
        zip_file = f'/tmp/factura_{inv.invoice_ident}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'factura_{inv.invoice_ident}.xml')
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
        factura_exitosa = False
        
        try:
            response = client.request(dian.Habilitacion.SendBillSync(f'factura_{inv.invoice_ident}.zip', zip_base64))
            
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
            
            # Verificar primero si la factura fue rechazada por IsValid=False
            if hasattr(response, 'IsValid') and not response.IsValid:
                print(f"\n❌ DOCUMENTO RECHAZADO POR LA DIAN")
                print(f"📝 Razón: {getattr(response, 'StatusDescription', 'Sin descripción')}")
                print(f"📊 Código: {getattr(response, 'StatusCode', 'Sin código')}")
                
                # Procesar errores si existen (sin duplicar lógica)
                if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                    errors = response.ErrorMessage
                    if hasattr(errors, 'string'):
                        error_list = errors.string if isinstance(
                            errors.string, list) else [errors.string]
                    else:
                        error_list = [errors] if isinstance(errors, str) else []
                    
                    if error_list:
                        # Detectar si es documento duplicado
                        es_duplicado = any(
                            bool(re.search(
                                r'regla[:)]?\s*90|procesado\s+anteriormente',
                                str(error), re.IGNORECASE))
                            for error in error_list
                        )
                        
                        if es_duplicado:
                            print(f"\n⚠️  Consecutivo {num_factura} ya procesado")
                            guardar_consecutivo(num_factura)
                            print(f"💾 Consecutivo {num_factura} marcado")
                            # Solo reintentar para duplicados
                            num_factura += 1
                            continue
                        else:
                            # Error de validación - NO reintentar
                            print(f"\n❌ TOTAL DE ERRORES: {len(error_list)}")
                            print("="*80)
                            print("\n📝 DETALLE DE ERRORES:")
                            print("-"*80)
                            for i, error in enumerate(error_list, 1):
                                print(f"{i:3d}. {error}")
                            guardar_consecutivo(num_factura)
                            print(f"💾 Consecutivo {num_factura} guardado")
                            print(f"   Próximo consecutivo: {num_factura + 1}")
                            # NO reintentar - salir del bucle
                            break
                
                # Si IsValid=False pero no hay ErrorMessage, salir del bucle
                break
            
            # Si IsValid=True, procesar como documento exitoso
            if hasattr(response, 'ErrorMessage') and response.ErrorMessage:
                errors = response.ErrorMessage
                if hasattr(errors, 'string'):
                    error_list = errors.string if isinstance(
                        errors.string, list) else [errors.string]
                else:
                    error_list = [errors] if isinstance(errors, str) else []
                
                if error_list:
                    # Detectar duplicado
                    es_duplicado = any(
                        bool(re.search(
                            r'regla[:)]?\s*90|procesado\s+anteriormente',
                            str(error), re.IGNORECASE))
                        for error in error_list
                    )
                    
                    if es_duplicado:
                        print(f"\n⚠️  Consecutivo {num_factura} ya procesado")
                        guardar_consecutivo(num_factura)
                        print(f"💾 Consecutivo {num_factura} marcado")
                        num_factura += 1
                        continue  # Solo reintentar duplicados
                    else:
                        # Error de validación - NO reintentar
                        print(f"\n❌ TOTAL DE ERRORES: {len(error_list)}")
                        print("="*80)
                        print("\n📝 DETALLE DE ERRORES:")
                        print("-"*80)
                        for i, error in enumerate(error_list, 1):
                            print(f"{i:3d}. {error}")
                        guardar_consecutivo(num_factura)
                        print(f"💾 Consecutivo {num_factura} guardado")
                        print(f"   Próximo consecutivo: {num_factura + 1}")
                        break  # NO reintentar
                else:
                    print("\n✅ ¡FACTURA ACEPTADA SIN ERRORES!")
                    factura_exitosa = True
                    if hasattr(response, 'IsValid') and response.IsValid:
                        guardar_consecutivo(num_factura)
                        print(f"💾 Consecutivo guardado: {num_factura}")
                        print(f"   Próximo consecutivo: {num_factura + 1}")
                    break
            else:
                print("\n✅ ¡FACTURA ACEPTADA SIN ERRORES!")
                factura_exitosa = True
                if hasattr(response, 'IsValid') and response.IsValid:
                    guardar_consecutivo(num_factura)
                    print(f"💾 Consecutivo guardado: {num_factura}")
                    print(f"   Próximo consecutivo: {num_factura + 1}")
                break
                
        except Exception as e:
            print("\n" + "="*80)
            print("❌ ERROR EN LA COMUNICACIÓN CON DIAN")
            print("="*80)
            print(f"Tipo de error: {type(e).__name__}")
            print(f"Mensaje: {str(e)}")
            print(f"Consecutivo afectado: {num_factura}")
            print("\n📋 Stack Trace:")
            print("-"*80)
            import traceback
            traceback.print_exc()
            print("-"*80)
            
            # Guardar consecutivo por seguridad
            guardar_consecutivo(num_factura)
            print(f"\n💾 Consecutivo {num_factura} guardado por seguridad")
            print("   Razón: Error de comunicación")
            print(f"   Próximo consecutivo: {num_factura + 1}")
            
            # NO reintentar en errores de comunicación
            break
        
        finally:
            print("\n📁 Archivos guardados:")
            print(f"   XML: {xml_file}")
            print(f"   ZIP: {zip_file}")
    
    # Mensaje final después del bucle
    if intento >= MAX_INTENTOS and not factura_exitosa:
        # Guardar el último consecutivo intentado para continuar desde ahí en el próximo intento
        guardar_consecutivo(num_factura)
        print(f"\n⚠️  Se alcanzó el máximo de intentos ({MAX_INTENTOS}) sin éxito.")
        print(f"   Último consecutivo intentado: {num_factura}")
        print(f"💾 Progreso guardado. Próximo intento comenzará desde: {num_factura + 1}")
    
    print("\n" + "="*80)
    print("🎯 DATOS USADOS EN LA FACTURA (DESDE FRONTEND):")
    print(f"   NIT Emisor: {EMPRESA_NIT}-{EMPRESA_DV}")
    print(f"   Razón Social: {EMPRESA_RAZON_SOCIAL}")
    print(f"   Email: {EMPRESA_EMAIL}")
    print(f"   Ciudad: {EMPRESA_CIUDAD_NOMBRE}")
    print("="*80)

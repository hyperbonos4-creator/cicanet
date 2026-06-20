#!/usr/bin/env python3
"""
🚀 Script de envío de Facturas Electrónicas a DIAN - AMBIENTE PRODUCCIÓN
✅ Configurado para ambiente de producción (NO TestSet)
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
"""
import sys
import os
import re
from pathlib import Path

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
    print('   Uso: python3 enviar_factura_produccion.py <NIT> [consecutivo]')
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
print('📋 CONFIGURACIÓN COMPLETA - FACTURA ELECTRÓNICA - PRODUCCIÓN')
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
print('\n🔐 CONFIGURACIÓN DIAN - SOFTWARE PRODUCCIÓN:')
print(f'   Software ID: {config_dian.SOFTWARE_ID}')
print(f'   PIN: {config_dian.PIN[:4]}***{config_dian.PIN[-4:] if len(config_dian.PIN) > 8 else "***"}')
print(f'   Clave Técnica: {config_dian.CLAVE_TECNICA[:8]}...{config_dian.CLAVE_TECNICA[-8:] if len(config_dian.CLAVE_TECNICA) > 16 else "***"}')
print(f'   Certificado Password: {"***" + config_dian.CERTIFICADO_PASSWORD[-4:] if len(config_dian.CERTIFICADO_PASSWORD) > 4 else "***"}')
print('\n📄 RESOLUCIÓN DE FACTURACIÓN (PRODUCCIÓN):')
print(f'   Número Resolución: {config_dian.RESOLUCION_NUMERO}')
print(f'   Prefijo: {config_dian.PREFIJO}')
print(f'   Rango Desde: {config_dian.RANGO_DESDE}')
print(f'   Rango Hasta: {config_dian.RANGO_HASTA}')
print(f'   Fecha Vigencia Desde: {config_dian.RESOLUCION_FECHA_DESDE}')
print(f'   Fecha Vigencia Hasta: {config_dian.RESOLUCION_FECHA_HASTA}')
print('\n🌍 AMBIENTE:')
print(f'   Ambiente: 🔴 PRODUCCIÓN (Documentos REALES)')
print(f'   URL: https://vpfe.dian.gov.co/WcfDianCustomerServices.svc')
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

# Contraseña del certificado
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
# VALIDACIÓN DE CONFIGURACIÓN DE FACTURA ELECTRÓNICA - PRODUCCIÓN
# ============================================================================
print('='*80)
print('🔍 VALIDANDO CONFIGURACIÓN DE FACTURA ELECTRÓNICA - PRODUCCIÓN')
print('='*80)

campos_requeridos = {
    'RESOLUCION_NUMERO': RESOLUCION_NUMERO,
    'PREFIJO': RESOLUCION_PREFIJO,
    'RANGO_DESDE': RESOLUCION_NUMERO_DESDE,
    'RANGO_HASTA': RESOLUCION_NUMERO_HASTA,
    'SOFTWARE_ID': ID_SOFTWARE,
    'PIN': PIN_SOFTWARE,
    'CLAVE_TECNICA': CLAVE_TECNICA
    # NOTA: NO se requiere TEST_SET_ID en producción
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
    print('   Ve a: Configuración > PRODUCCIÓN > Software DIAN / Resolución')
    print('='*80)
    sys.exit(1)

print('='*80)
print('✅ CONFIGURACIÓN VÁLIDA - Procediendo con el envío a PRODUCCIÓN')
print('='*80 + '\n')

# ============================================================================
# AMBIENTE PRODUCCIÓN
# ============================================================================
AMBIENTE = fe.AMBIENTE_PRODUCCION  # ProfileExecutionID = 1 (Producción)

# Sistema de consecutivos - archivo específico para producción
CONSECUTIVO_FILE = f'certificados/{EMPRESA_NIT}/.ultimo_consecutivo_factura_prod.txt'


# ============================================================================
# FUNCIÓN: EXTENSIONES DIAN
# ============================================================================
def extensions(inv):
    """
    Genera las extensiones XML requeridas por la DIAN para PRODUCCIÓN
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
    
    return [security_code, authorization_provider, cufe, software_provider, inv_authorization]


# ============================================================================
# FUNCIÓN: CREAR XML DE FACTURA
# ============================================================================
def document_xml():
    """
    Genera el XML con el formato UBL requerido por DIAN para PRODUCCIÓN
    """
    return form_xml.DIANInvoiceXML


# ============================================================================
# FUNCIÓN: CREAR FACTURA DE EJEMPLO
# ============================================================================
def invoice():
    """
    Crea una factura con datos de prueba
    """
    inv = form.Invoice('01')
    
    # Periodo de facturación
    inv.set_period(datetime.now(), datetime.now())
    
    # Fecha de emisión
    inv.set_issue(datetime.now())
    
    # Tipo de operación: 10 = Estándar
    inv.set_operation_type('10')
    
    # Forma de pago: 1 = Contado
    inv.set_payment_mean(form.PaymentMean(
        form.PaymentMean.CASH,
        '10'  # Código DIAN para Efectivo
    ))
    
    # Vendedor (Nuestra empresa)
    supplier = form.Party(
        legal_name=EMPRESA_RAZON_SOCIAL,
        name=EMPRESA_NOMBRE_COMERCIAL,
        ident=form.PartyIdentification(EMPRESA_NIT, EMPRESA_DV, '31'),
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
                EMPRESA_DEPARTAMENTO_CODIGO, EMPRESA_DEPARTAMENTO_NOMBRE
            )
        )
    )
    inv.set_supplier(supplier)
    
    # Comprador (Cliente de prueba)
    # En producción deberías recibir estos datos como parámetros
    customer = form.Party(
        legal_name='CLIENTE DE PRODUCCION',
        name='CLIENTE DE PRODUCCION',
        ident=form.PartyIdentification('900000001', '0', '31'),
        responsability_code=form.Responsability(['R-99-PN']),
        responsability_regime_code='49',
        organization_code='1',
        email='cliente@ejemplo.com',
        phone='3001234567',
        address=form.Address(
            name='Calle 100 # 10-10',
            street='Calle 100 # 10-10',
            city=form.City('11001', 'Bogotá D.C.'),
            country=form.Country('CO', 'Colombia'),
            countrysubentity=form.CountrySubentity('11', 'Bogotá D.C.')
        )
    )
    inv.set_customer(customer)
    
    # Líneas de factura
    line = form.InvoiceLine(
        quantity=form.Quantity(1, '94'),
        description='Servicio de Producción',
        item=form.StandardItem('SERVICIO001'),
        price=form.Price(form.Amount(100000, 'COP'), '01', '94'),
        tax=form.TaxTotal(form.TaxSubTotal(
            tax_amount=form.Amount(19000, 'COP'),
            taxable_amount=form.Amount(100000, 'COP'),
            percent=19.00,
            tax_category='O-07'  # IVA
        ))
    )
    inv.add_invoice_line(line)
    
    return inv


# ============================================================================
# SISTEMA DE CONSECUTIVOS
# ============================================================================
def obtener_consecutivo(especifico=None):
    """Obtiene el siguiente consecutivo disponible"""
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
    """Guarda el último consecutivo usado"""
    os.makedirs(os.path.dirname(CONSECUTIVO_FILE), exist_ok=True)
    with open(CONSECUTIVO_FILE, 'w') as f:
        f.write(str(num))


# ============================================================================
# EJECUCIÓN PRINCIPAL
# ============================================================================
if __name__ == '__main__':
    print('\n' + '🔴'*40)
    print('⚠️  ATENCIÓN: ENVIANDO A AMBIENTE DE PRODUCCIÓN')
    print('    Los documentos enviados tienen valor legal y tributario')
    print('🔴'*40 + '\n')
    
    # Obtener consecutivo
    if len(sys.argv) > 2:
        num_factura_inicial = obtener_consecutivo(sys.argv[2])
        print(f'ℹ️  Usando número especificado: {num_factura_inicial}')
    else:
        num_factura_inicial = obtener_consecutivo()
        print(f'ℹ️  Usando siguiente consecutivo: {num_factura_inicial}')
    
    # Validar que el consecutivo esté en el rango autorizado
    if num_factura_inicial < RESOLUCION_NUMERO_DESDE or num_factura_inicial > RESOLUCION_NUMERO_HASTA:
        print(f'❌ ERROR: Consecutivo {num_factura_inicial} fuera del rango autorizado')
        print(f'   Rango válido: {RESOLUCION_NUMERO_DESDE} - {RESOLUCION_NUMERO_HASTA}')
        sys.exit(1)
    
    MAX_INTENTOS = getattr(config_dian, 'MAX_INTENTOS_ENVIO', 5)  # Menos intentos en producción
    num_factura = num_factura_inicial
    intento = 0
    
    while intento < MAX_INTENTOS:
        intento += 1
        if intento > 1:
            print(f"\n🔄 Reintento {intento}/{MAX_INTENTOS} con consecutivo: {num_factura}")
        
        print("="*80)
        print(f"📋 ENVIANDO FACTURA {RESOLUCION_PREFIJO}{num_factura} A DIAN PRODUCCIÓN")
        print("="*80)
        
        # Generar factura
        inv = invoice()
        inv.set_ident(f'{RESOLUCION_PREFIJO}{num_factura}')
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
        print(f'   Ambiente: 🔴 PRODUCCIÓN (ProfileExecutionID=1)')
        
        # Generar XML
        xml = document_xml()(inv)
        
        # Agregar extensiones
        for extension in extensions(inv):
            xml.add_extension(extension)
        
        # Firmar XML
        xml_file = f'/tmp/factura_prod_{inv.invoice_ident}_firmada.xml'
        cert_path = f'certificados/{EMPRESA_NIT}/certificado_digital.pfx'
        form_xml.DIANWriteSigned(xml, xml_file, cert_path, CERTIFICADO_PASSWORD, use_cache_policy=False)
        print(f"✅ XML firmado: {xml_file}")
        
        # Crear ZIP
        zip_file = f'/tmp/factura_prod_{inv.invoice_ident}.zip'
        with zipfile.ZipFile(zip_file, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, f'factura_{inv.invoice_ident}.xml')
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
        
        factura_exitosa = False
        
        try:
            # ================================================================
            # PRODUCCIÓN: Usa dian.SendBillSync (NO dian.Habilitacion.SendBillSync)
            # Esto envía directamente a vpfe.dian.gov.co
            # ================================================================
            response = client.request(dian.SendBillSync(
                f'factura_{inv.invoice_ident}.zip', 
                zip_base64
            ))
            
            print("\n📨 RESPUESTA DE LA DIAN (PRODUCCIÓN):")
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
                print(f"\n❌ DOCUMENTO RECHAZADO POR LA DIAN")
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
                            print(f"\n⚠️  Consecutivo {num_factura} ya procesado")
                            guardar_consecutivo(num_factura)
                            num_factura += 1
                            continue
                        else:
                            print(f"\n❌ ERRORES DE VALIDACIÓN:")
                            for i, error in enumerate(error_list, 1):
                                print(f"   {i}. {error}")
                            guardar_consecutivo(num_factura)
                            break
                break
            else:
                print("\n✅ ¡FACTURA ACEPTADA EN PRODUCCIÓN!")
                factura_exitosa = True
                if hasattr(response, 'IsValid') and response.IsValid:
                    guardar_consecutivo(num_factura)
                    print(f"💾 Consecutivo guardado: {num_factura}")
                break
                
        except Exception as e:
            print("\n" + "="*80)
            print("❌ ERROR EN LA COMUNICACIÓN CON DIAN")
            print("="*80)
            print(f"Tipo de error: {type(e).__name__}")
            print(f"Mensaje: {str(e)}")
            import traceback
            traceback.print_exc()
            guardar_consecutivo(num_factura)
            break
        
        finally:
            print("\n📁 Archivos guardados:")
            print(f"   XML: {xml_file}")
            print(f"   ZIP: {zip_file}")
    
    print("\n" + "="*80)
    print("🔴 PRODUCCIÓN - DATOS USADOS EN LA FACTURA:")
    print(f"   NIT Emisor: {EMPRESA_NIT}-{EMPRESA_DV}")
    print(f"   Razón Social: {EMPRESA_RAZON_SOCIAL}")
    print(f"   Email: {EMPRESA_EMAIL}")
    print("="*80)

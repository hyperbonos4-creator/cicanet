"""
Funciones de construcción de facturas electrónicas (Invoice builder).
Extraídas de api_server.py para modularidad.
"""

from datetime import datetime
from typing import Dict, Any, List

from facho.fe import form
from facho import fe

from models import (
    SolicitudFactura,
    ConfiguracionDIAN,
    EmpresaFactura,
)


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


def crear_extensiones_dian(
    inv: form.Invoice,
    config: ConfiguracionDIAN,
    empresa: EmpresaFactura,
) -> List:
    """
    Crea las extensiones XML requeridas por la DIAN
    """
    # Determinar ambiente
    ambiente = (
        fe.AMBIENTE_PRODUCCION
        if config.ambiente.lower() == 'produccion'
        else fe.AMBIENTE_PRUEBAS
    )

    security_code = fe.DianXMLExtensionSoftwareSecurityCode(
        config.software_id,
        config.software_pin,
        inv.invoice_ident,
    )

    authorization_provider = fe.DianXMLExtensionAuthorizationProvider()

    cufe = fe.DianXMLExtensionCUFE(
        inv,
        config.clave_tecnica,
        ambiente,
    )

    software_provider = fe.DianXMLExtensionSoftwareProvider(
        empresa.nit,
        empresa.dv,
        config.software_id,
    )

    fecha_desde = datetime.strptime(config.resolucion_fecha_desde, '%Y-%m-%d')
    fecha_hasta = datetime.strptime(config.resolucion_fecha_hasta, '%Y-%m-%d')

    inv_authorization = fe.DianXMLExtensionInvoiceAuthorization(
        config.resolucion_numero,
        fecha_desde,
        fecha_hasta,
        config.resolucion_prefijo,
        config.resolucion_desde,
        config.resolucion_hasta,
    )

    return [
        security_code,
        authorization_provider,
        cufe,
        software_provider,
        inv_authorization,
    ]

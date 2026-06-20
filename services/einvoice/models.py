"""
Modelos Pydantic para la API de facturación electrónica DIAN.
Extraídos de api_server.py para modularidad.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


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
# MODELOS NOTA DE AJUSTE
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
    direccion: str = Field("Sin dirección", description="Dirección")
    ciudad_codigo: str = Field("05001", description="Código DANE ciudad")
    ciudad_nombre: str = Field("Medellín", description="Nombre ciudad")
    departamento_codigo: str = Field("05", description="Código DANE departamento")
    departamento_nombre: str = Field("Antioquia", description="Nombre departamento")
    email: str = Field("no-email@example.com", description="Email")
    telefono: str = Field("", description="Teléfono")


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

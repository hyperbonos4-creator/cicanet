"""
Nota de Ajuste al Documento Soporte en adquisiciones efectuadas a sujetos no obligados
(CreditNote para Documento Soporte)

Según Anexo Técnico DIAN v1.1 - Resolución 000167 (30 DIC 2021)
Sección 8.2 - Páginas 70 a 107

Tipo de Documento: 95 (Nota de Ajuste)
Códigos de Corrección (ResponseCode):
    1 = Devolución parcial de los bienes y/o no aceptación parcial del servicio
    2 = Anulación del documento soporte (PARA ANULACIÓN COMPLETA)
    3 = Rebaja o descuento parcial o total
    4 = Ajuste de precio
    5 = Otros

Elementos adicionales vs Documento Soporte:
    - DiscrepancyResponse: Motivo de la nota de ajuste
    - BillingReference: Referencia al documento soporte original
"""

from .. import fe
from ..form import *
from .support_document import DIANSupportDocumentXML

__all__ = ['DIANSupportDocumentCreditNoteXML']


class DIANSupportDocumentCreditNoteXML(DIANSupportDocumentXML):
    """
    DIANSupportDocumentCreditNoteXML genera el XML de Nota de Ajuste al Documento Soporte
    según el Anexo Técnico DIAN v1.1 - Sección 8.2
    
    El documento es de tipo CreditNote con InvoiceTypeCode = '95'
    """

    def __init__(self, invoice):
        """
        Inicializa la nota de ajuste con namespace de CreditNote
        
        IMPORTANTE: CreditNote usa un namespace diferente a Invoice:
        - Invoice: urn:oasis:names:specification:ubl:schema:xsd:Invoice-2
        - CreditNote: urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2
        """
        # Llamar directamente al constructor de FeXML con el namespace correcto de CreditNote
        fe.FeXML.__init__(self, 'CreditNote', 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2')
        
        # Crear placeholders para extensiones DIAN
        self.placeholder_for('./ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceControl')
        self.placeholder_for('./ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:InvoiceSource')
        self.placeholder_for('./ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:SoftwareProvider')
        self.placeholder_for('./ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:SoftwareSecurityCode')
        self.placeholder_for('./ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sts:DianExtensions/sts:AuthorizationProvider/sts:AuthorizationProviderID')
        
        # ZE02 se requiere existencia para firmar
        ublextension = self.fragment('./ext:UBLExtensions/ext:UBLExtension', append=True)
        extcontent = ublextension.find_or_create_element('/ext:UBLExtension/ext:ExtensionContent')
        
        # Adjuntar invoice y configurar CreditNote
        self.attach_invoice(invoice)
        self.post_attach_invoice(invoice)

    def tag_document(self):
        """Retorna el tag del documento raíz"""
        return 'CreditNote'

    def tag_document_concilied(self):
        """Retorna el tag para cantidades conciliadas"""
        return 'Credited'

    def post_attach_invoice(self, invoice):
        """
        Configura campos específicos de la Nota de Ajuste según Anexo v1.1
        
        Diferencias con Documento Soporte:
        - ProfileID específico para Nota de Ajuste
        - CreditNoteTypeCode = '95' (Nota de Ajuste al DS)
        """
        # NSAD03: ProfileID específico para Nota de Ajuste (pág 71)
        # Debe ser EXACTAMENTE este literal según Anexo Técnico v1.1
        self.set_element('./cbc:ProfileID', 
            'DIAN 2.1: Nota de ajuste al documento soporte en adquisiciones efectuadas a sujetos no obligados a expedir factura o documento equivalente')
        
        # NSAD12: CreditNoteTypeCode = '95' (Nota de Ajuste) según tabla 16.1.3
        self.set_element('./cbc:CreditNoteTypeCode', '95')

    def attach_invoice(self, invoice):
        """
        Sobrescribe attach_invoice para incluir elementos específicos de Nota de Ajuste:
        - DiscrepancyResponse (motivo de la nota)
        - BillingReference (referencia al documento original)
        
        Según esquema UBL CreditNote-2.1 y Anexo Técnico DIAN v1.1, 
        el orden CORRECTO de elementos es:
        1. UBLExtensions
        2. UBLVersionID, CustomizationID, ProfileID, ProfileExecutionID
        3. ID, UUID, IssueDate, IssueTime
        4. CreditNoteTypeCode
        5. DocumentCurrencyCode, LineCountNumeric
        6. DiscrepancyResponse (OBLIGATORIO)
        7. BillingReference (OBLIGATORIO)
        8. AccountingSupplierParty, AccountingCustomerParty
        9. PaymentMeans, AllowanceCharge, TaxTotal, WithholdingTaxTotal
        10. LegalMonetaryTotal, CreditNoteLine
        
        NOTA: No se incluye InvoicePeriod a nivel documento para Nota de Ajuste DS.
              El período se maneja solo a nivel de línea (CreditNoteLine/InvoicePeriod).
        """
        self.placeholder_for('./ext:UBLExtensions')
        self.set_element('./cbc:UBLVersionID', 'UBL 2.1')
        self.set_element('./cbc:CustomizationID', invoice.invoice_operation_type)
        self.placeholder_for('./cbc:ProfileID')
        self.placeholder_for('./cbc:ProfileExecutionID')
        self.set_element('./cbc:ID', invoice.invoice_ident)
        self.placeholder_for('./cbc:UUID')
        self.set_element('./cbc:IssueDate', invoice.invoice_issue.strftime('%Y-%m-%d'))
        self.set_element('./cbc:IssueTime', invoice.invoice_issue.strftime('%H:%M:%S-05:00'))
        
        # NSAD12: CreditNoteTypeCode (se configura en post_attach_invoice)
        self.set_element('./cbc:CreditNoteTypeCode', '95')
        
        self.set_element('./cbc:DocumentCurrencyCode', 'COP')
        self.set_element('./cbc:LineCountNumeric', len(invoice.invoice_lines))
        
        # NSBF01-NSBF03: DiscrepancyResponse (OBLIGATORIO para Nota de Ajuste)
        self.set_discrepancy_response(invoice)
        
        # NSBG01-NSBG06: BillingReference (OBLIGATORIO - referencia al DS original)
        self.set_billing_reference(invoice)
        
        # NO InvoicePeriod a nivel documento para Nota de Ajuste DS
        # El período se maneja en cada CreditNoteLine

        self.customize(invoice)

        self.set_supplier(invoice)
        self.set_customer(invoice)
        self.set_payment_mean(invoice)
        self.set_allowance_charge(invoice)
        self.set_invoice_totals(invoice)
        self.set_withholding_tax_total(invoice)
        self.set_legal_monetary(invoice)
        self.set_invoice_lines(invoice)

        return self

    def set_discrepancy_response(self, invoice):
        """
        NSBF01-NSBF03: DiscrepancyResponse - Motivo de la Nota de Ajuste
        Según Anexo v1.1, sección 8.2, página 78
        
        Estructura:
        <cac:DiscrepancyResponse>
            <cbc:ReferenceID>PREFIJO1234</cbc:ReferenceID>  <!-- ID del DS original -->
            <cbc:ResponseCode>2</cbc:ResponseCode>          <!-- Código de corrección -->
            <cbc:Description>Anulación del documento...</cbc:Description>
        </cac:DiscrepancyResponse>
        
        Códigos de Corrección (ResponseCode) según tabla 16.2.4:
            1 = Devolución parcial de los bienes y/o no aceptación parcial del servicio
            2 = Anulación del documento soporte
            3 = Rebaja o descuento parcial o total
            4 = Ajuste de precio
            5 = Otros
        """
        # Verificar que tenga los datos de discrepancia
        if not hasattr(invoice, 'discrepancy_response'):
            raise ValueError(
                "La Nota de Ajuste requiere 'discrepancy_response' con "
                "reference_id, response_code y description"
            )
        
        discrepancy = invoice.discrepancy_response
        
        self.placeholder_for('./cac:DiscrepancyResponse')
        
        # NSBF02: ReferenceID - ID del documento soporte original
        self.set_element('./cac:DiscrepancyResponse/cbc:ReferenceID',
                        discrepancy.get('reference_id', ''))
        
        # NSBF03: ResponseCode - Código de corrección (1-5)
        self.set_element('./cac:DiscrepancyResponse/cbc:ResponseCode',
                        str(discrepancy.get('response_code', '2')))
        
        # Descripción del motivo
        description = discrepancy.get('description', '')
        if not description:
            # Descripciones por defecto según código
            descriptions = {
                '1': 'Devolución parcial de los bienes y/o no aceptación parcial del servicio',
                '2': 'Anulación del documento soporte en adquisiciones efectuadas a sujetos no obligados a expedir factura de venta o documento equivalente',
                '3': 'Rebaja o descuento parcial o total',
                '4': 'Ajuste de precio',
                '5': 'Otros'
            }
            description = descriptions.get(
                str(discrepancy.get('response_code', '2')),
                'Anulación del documento soporte'
            )
        
        self.set_element('./cac:DiscrepancyResponse/cbc:Description', description)

    def set_billing_reference(self, invoice):
        """
        NSBG01-NSBG06: BillingReference - Referencia al Documento Soporte original
        Según Anexo v1.1, sección 8.2, página 79
        
        Estructura:
        <cac:BillingReference>
            <cac:InvoiceDocumentReference>
                <cbc:ID>PREFIJO1234</cbc:ID>           <!-- Prefijo+Número DS original -->
                <cbc:UUID schemeName="CUDS-SHA384">...</cbc:UUID>  <!-- CUDS del DS original -->
                <cbc:IssueDate>2024-01-15</cbc:IssueDate>  <!-- Fecha del DS original -->
            </cac:InvoiceDocumentReference>
        </cac:BillingReference>
        """
        # Verificar que tenga los datos de referencia
        # El atributo se llama invoice_billing_reference en form.Invoice
        if not hasattr(invoice, 'invoice_billing_reference') or invoice.invoice_billing_reference is None:
            raise ValueError(
                "La Nota de Ajuste requiere 'billing_reference' con "
                "id, uuid y issue_date del documento soporte original"
            )
        
        reference = invoice.invoice_billing_reference
        
        self.placeholder_for('./cac:BillingReference')
        self.placeholder_for('./cac:BillingReference/cac:InvoiceDocumentReference')
        
        # NSBG02: ID - Prefijo + Número del DS original
        # Soportar tanto diccionario como objeto BillingReference
        ref_id = reference.get('id', '') if isinstance(reference, dict) else reference.ident
        self.set_element('./cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID', ref_id)
        
        # NSBG03: UUID - CUDS del documento soporte original
        ref_uuid = reference.get('uuid', '') if isinstance(reference, dict) else reference.uuid
        self.set_element('./cac:BillingReference/cac:InvoiceDocumentReference/cbc:UUID',
                        ref_uuid,
                        schemeName='CUDS-SHA384')
        
        # NSBG06: IssueDate - Fecha del DS original
        ref_date = reference.get('issue_date', '') if isinstance(reference, dict) else reference.date
        if hasattr(ref_date, 'strftime'):
            ref_date = ref_date.strftime('%Y-%m-%d')
        self.set_element('./cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate',
                        ref_date)

    def set_invoice_lines(self, invoice):
        """
        Sobrescribe para usar CreditNoteLine en lugar de InvoiceLine
        y CreditNotePeriod en lugar de InvoicePeriod
        
        Según Anexo v1.1 Sección 8.2.1 (CreditNoteLine), página 95
        """
        from datetime import timedelta
        
        next_append = False
        for index, invoice_line in enumerate(invoice.invoice_lines):
            # Usar CreditNoteLine
            line = self.fragment('./cac:CreditNoteLine', append=next_append)
            next_append = True

            line.set_element('./cbc:ID', index + 1)
            # CreditedQuantity en lugar de InvoicedQuantity
            line.set_element('./cbc:CreditedQuantity', 
                           invoice_line.quantity, 
                           unitCode=invoice_line.quantity.code)
            self.set_element_amount_for(line,
                                         './cbc:LineExtensionAmount',
                                         invoice_line.total_amount)

            # CreditNotePeriod en línea (según NSFC01-NSFC04)
            description_code = getattr(invoice_line, 'description_code', '1') or '1'
            period_start = getattr(invoice_line, 'period_start_date', None)
            
            if period_start is None:
                period_start = invoice.invoice_period_start
            
            signing_date = invoice.invoice_period_start
            if description_code == '1':
                if period_start != signing_date:
                    period_start = signing_date
            elif description_code == '2':
                min_allowed_date = signing_date - timedelta(days=6)
                if period_start < min_allowed_date:
                    period_start = min_allowed_date
                if period_start > signing_date:
                    period_start = signing_date
            
            description_map = {
                '1': 'Por operación',
                '2': 'Acumulado semanal'
            }
            description_text = description_map.get(description_code, 'Por operación')
            
            # Usar CreditNotePeriod en la línea
            line.set_element('./cac:InvoicePeriod/cbc:StartDate', 
                             period_start.strftime('%Y-%m-%d'))
            line.set_element('./cac:InvoicePeriod/cbc:DescriptionCode', description_code)
            line.set_element('./cac:InvoicePeriod/cbc:Description', description_text)

            if not isinstance(invoice_line.tax, TaxTotalOmit):
                self.set_invoice_line_tax(line, invoice_line)

            line.set_element('./cac:Item/cbc:Description', invoice_line.item.description)

            std_item_attrs = {}
            if invoice_line.item.scheme_id:
                std_item_attrs['schemeID'] = invoice_line.item.scheme_id
            if invoice_line.item.scheme_name:
                std_item_attrs['schemeName'] = invoice_line.item.scheme_name
            if invoice_line.item.scheme_agency_id:
                std_item_attrs['schemeAgencyID'] = invoice_line.item.scheme_agency_id
            
            if not std_item_attrs:
                std_item_attrs = {
                    'schemeAgencyID': '195',
                    'schemeName': '31',
                    'schemeID': '999'
                }
            
            line.set_element('./cac:Item/cac:StandardItemIdentification/cbc:ID',
                             invoice_line.item.id,
                             **std_item_attrs)

            line.set_element('./cac:Price/cbc:PriceAmount', 
                           invoice_line.price.amount, 
                           currencyID=invoice_line.price.amount.currency.code)
            line.set_element('./cac:Price/cbc:BaseQuantity',
                             invoice_line.price.quantity,
                             unitCode=invoice_line.quantity.code)

            for idx, charge in enumerate(invoice_line.allowance_charge):
                next_append_charge = idx > 0
                self.append_allowance_charge(line, index + 1, charge, append=next_append_charge)

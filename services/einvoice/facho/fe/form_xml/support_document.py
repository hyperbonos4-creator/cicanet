from .. import fe
from ..form import *
from .invoice import DIANInvoiceXML

__all__ = ['DIANSupportDocumentXML']

class DIANSupportDocumentXML(DIANInvoiceXML):
    """
    DIANSupportDocumentXML mapea objeto form.Invoice a XML según
    lo indicado para el Documento Soporte en adquisiciones a no obligados.
    
    DIFERENCIAS CRÍTICAS vs FACTURA según Anexo Técnico v1.1 (Sección 5, pág 12-13):
    
    ELIMINADOS EN SUPPLIER (Vendedor/SNO):
    - PartyLegalEntity (Registro Mercantil comerciante) - ELIMINADO
    - Contact (Información de contacto) - ELIMINADO
    
    ELIMINADOS EN CUSTOMER (Adquirente/ABS):
    - PhysicalLocation (Ubicación física) - ELIMINADO
    - Contact (Información de contacto) - ELIMINADO
    
    ELIMINADOS DEL DOCUMENTO:
    - Delivery (Información de entrega)
    - DeliveryTerms (Términos de entrega)
    - PrepaidPayment (Anticipos)
    
    ELIMINADOS DE InvoiceLine:
    - PricingReference (Precios de referencia para líneas sin valor comercial)
    
    AGREGADO para Documento Soporte:
    - WithholdingTaxTotal (DSAT01-DSAT13): Retención en la fuente para premios
    """

    def __init__(self, invoice, tag_document='Invoice'):
        super().__init__(invoice, tag_document)

    def attach_invoice(self, invoice):
        """
        Sobrescribe attach_invoice para insertar WithholdingTaxTotal en el orden correcto.
        
        Según Anexo Técnico DIAN v1.1, el orden de elementos debe ser:
        1. TaxTotal (impuestos)
        2. WithholdingTaxTotal (retenciones) - DESPUÉS de TaxTotal
        3. LegalMonetaryTotal (totales)
        4. InvoiceLine (líneas del documento)
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
        self.set_element('./cbc:%sTypeCode' % (self.tag_document()),
                        invoice.invoice_type_code)
        self.set_element('./cbc:DocumentCurrencyCode', 'COP')
        self.set_element('./cbc:LineCountNumeric', len(invoice.invoice_lines))
        self.set_element('./cac:%sPeriod/cbc:StartDate' % (self.tag_document()),
                          invoice.invoice_period_start.strftime('%Y-%m-%d'))

        self.set_element('./cac:%sPeriod/cbc:EndDate' % (self.tag_document()),
                          invoice.invoice_period_end.strftime('%Y-%m-%d'))

        self.customize(invoice)

        self.set_supplier(invoice)
        self.set_customer(invoice)
        self.set_payment_mean(invoice)
        self.set_allowance_charge(invoice)
        self.set_invoice_totals(invoice)
        
        # ⚠️ IMPORTANTE: WithholdingTaxTotal debe ir DESPUÉS de TaxTotal 
        # y ANTES de LegalMonetaryTotal según el Anexo Técnico DIAN v1.1
        self.set_withholding_tax_total(invoice)
        
        self.set_legal_monetary(invoice)
        self.set_invoice_lines(invoice)
        self.set_billing_reference(invoice)

        return self

    def post_attach_invoice(self, invoice):
        """
        Configura campos específicos del Documento Soporte según Anexo v1.1
        """
        # DSAD03: ProfileID específico (pág 30, línea 2777-2790)
        self.set_element('./cbc:ProfileID', 'DIAN 2.1: documento soporte en adquisiciones efectuadas a no obligados a facturar.')
        
        # DSAD12: InvoiceTypeCode = '05' (pág 31, línea 3034)
        self.set_element('./cbc:InvoiceTypeCode', '05')
    
    def set_withholding_tax_total(self, invoice):
        """
        Genera el elemento WithholdingTaxTotal para Documento Soporte.
        Según Anexo Técnico DIAN v1.1, sección DSAT01-DSAT13.
        
        Este elemento es OPCIONAL (0..N) y se usa para informar retenciones como:
        - ReteRenta (código 06): 20% para premios de loterías, rifas, apuestas
        - ReteIVA (código 05): Retención sobre IVA
        
        Estructura XML esperada:
        <cac:WithholdingTaxTotal>
            <cbc:TaxAmount currencyID="COP">valor_retencion</cbc:TaxAmount>
            <cac:TaxSubtotal>
                <cbc:TaxableAmount currencyID="COP">base_gravable</cbc:TaxableAmount>
                <cbc:TaxAmount currencyID="COP">valor_retencion</cbc:TaxAmount>
                <cac:TaxCategory>
                    <cbc:Percent>20.00</cbc:Percent>
                    <cac:TaxScheme>
                        <cbc:ID>06</cbc:ID>
                        <cbc:Name>ReteRenta</cbc:Name>
                    </cac:TaxScheme>
                </cac:TaxCategory>
            </cac:TaxSubtotal>
        </cac:WithholdingTaxTotal>
        """
        # Solo generar si hay WithholdingTaxTotal configurado
        if not hasattr(invoice, 'invoice_withholding_tax_total') or invoice.invoice_withholding_tax_total is None:
            return
        
        withholding = invoice.invoice_withholding_tax_total
        
        # Crear fragmento WithholdingTaxTotal
        # Nota: Debe ir DESPUÉS de TaxTotal según el orden del Anexo Técnico
        self.placeholder_for('./cac:WithholdingTaxTotal')
        
        # DSAT02: TaxAmount total de retención
        self.set_element_amount('./cac:WithholdingTaxTotal/cbc:TaxAmount',
                                withholding.tax_amount)
        
        # Agregar cada TaxSubtotal
        for idx, subtotal in enumerate(withholding.subtotals):
            # DSAT03-DSAT13: TaxSubtotal
            if idx == 0:
                # Primer subtotal ya está en el placeholder
                subtotal_path = './cac:WithholdingTaxTotal/cac:TaxSubtotal'
            else:
                # Subtotales adicionales necesitan append
                line = self.fragment('./cac:WithholdingTaxTotal/cac:TaxSubtotal', append=True)
                subtotal_path = './cac:WithholdingTaxTotal/cac:TaxSubtotal[last()]'
            
            # DSAT04: TaxableAmount (Base gravable)
            self.set_element_amount(f'{subtotal_path}/cbc:TaxableAmount',
                                    subtotal.taxable_amount)
            
            # DSAT05: TaxAmount (Valor retención de este subtotal)
            self.set_element_amount(f'{subtotal_path}/cbc:TaxAmount',
                                    subtotal.tax_amount)
            
            # DSAT07: TaxCategory/Percent (Porcentaje de retención)
            self.set_element(f'{subtotal_path}/cac:TaxCategory/cbc:Percent',
                           '%0.2f' % round(subtotal.percent, 2))
            
            # DSAT08-DSAT09: TaxScheme (Tipo de tributo)
            self.set_element(f'{subtotal_path}/cac:TaxCategory/cac:TaxScheme/cbc:ID',
                           subtotal.scheme.code)
            self.set_element(f'{subtotal_path}/cac:TaxCategory/cac:TaxScheme/cbc:Name',
                           subtotal.scheme.name)
    
    def customize(self, invoice):
        """
        Método vacío - InvoicePeriod NO va a nivel de documento en DS
        Según DSFC01, el InvoicePeriod debe estar en InvoiceLine, no en el documento
        """
        pass


    def set_supplier(self, invoice):
        """
        SUPPLIER = Vendedor SNO (Sujeto No Obligado)
        
        Según Anexo v1.1, Sección 5 (Control de Versiones, pág 12-13):
        SE ELIMINARON de AccountingSupplierParty:
        - PartyLegalEntity
        - Contact
        
        ESTRUCTURA PERMITIDA:
        - AdditionalAccountID (Tipo persona: 1=Jurídica, 2=Natural)
        - Party/PartyName/Name (Nombre comercial)
        - Party/PhysicalLocation/Address (Dirección física) ✓ MANTENIDO
        - Party/PartyTaxScheme (Datos fiscales) ✓ MANTENIDO
        
        ★ Para No Residentes (CustomizationID=11):
        - Address solo contiene: CityName + Country (DSAJ08b)
        - Sin: ID (DIVIPOLA), PostalZone, CountrySubentity, AddressLine
        """
        self.placeholder_for('./cac:AccountingSupplierParty')

        # DSAJ02: AdditionalAccountID (pág 33)
        self.set_element('./cac:AccountingSupplierParty/cbc:AdditionalAccountID',
                          invoice.invoice_supplier.organization_code)

        # DSAJ06: PartyName (Nombre comercial)
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name',
                          invoice.invoice_supplier.name)

        # ★ Detectar si es dirección extranjera (No Residente)
        supplier_address = invoice.invoice_supplier.address
        is_foreign = getattr(supplier_address, 'is_foreign', False)

        # DSAJ07-DSAJ18: PhysicalLocation
        self.placeholder_for('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address')
        
        if is_foreign:
            # ============================================================
            # NO RESIDENTE (CustomizationID=11): Dirección extranjera
            # DSAJ14 requiere: CityName + CountrySubentity + AddressLine + Country
            # NO requiere: ID (DIVIPOLA), PostalZone
            # ============================================================
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CityName',
                              supplier_address.city_name)
            
            # DSAJ14: CountrySubentity requerido — usar estado/provincia extranjero
            state_prov = getattr(supplier_address, 'state_province', '') or supplier_address.country_name or supplier_address.city_name
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CountrySubentity',
                              state_prov)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CountrySubentityCode',
                              supplier_address.country_code)
            
            # DSAJ14: AddressLine requerido — dirección del sujeto foráneo
            addr_line = getattr(supplier_address, 'address_line', '') or supplier_address.city_name or 'No informada'
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:AddressLine/cbc:Line',
                              addr_line)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:Country/cbc:IdentificationCode',
                              supplier_address.country_code)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:Country/cbc:Name',
                              supplier_address.country_name,
                              languageID='es')
            # ❌ NO incluir: ID (DIVIPOLA), PostalZone (no aplica para extranjeros)
        else:
            # ============================================================
            # RESIDENTE (CustomizationID=10): Dirección completa colombiana
            # ============================================================
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:ID',
                              invoice.invoice_supplier.address.city.code)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CityName',
                              invoice.invoice_supplier.address.city.name)
            
            postal_zone = invoice.invoice_supplier.address.postal_code or (invoice.invoice_supplier.address.city.code + '00')
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:PostalZone',
                              postal_zone)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CountrySubentity',
                              invoice.invoice_supplier.address.countrysubentity.name)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cbc:CountrySubentityCode',
                              invoice.invoice_supplier.address.countrysubentity.code)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:AddressLine/cbc:Line',
                              invoice.invoice_supplier.address.street)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:Country/cbc:IdentificationCode',
                              invoice.invoice_supplier.address.country.code)
            
            self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PhysicalLocation/cac:Address/cac:Country/cbc:Name',
                              invoice.invoice_supplier.address.country.name,
                              languageID='es')

        # DSAJ19-DSAJ41: PartyTaxScheme (Información fiscal)
        supplier_company_id_attrs = fe.SCHEME_AGENCY_ATTRS.copy()
        # ★ schemeID = DV para residentes (NIT 31), vacío para no residentes
        # Para NIT (31): dv es obligatorio, si no existe usar type_fiscal como fallback
        # Para no residentes (21,22,41,42,47,50): dv NO aplica, dejar vacío
        supplier_dv = invoice.invoice_supplier.ident.dv
        supplier_type = invoice.invoice_supplier.ident.type_fiscal
        if supplier_dv:
            scheme_id_supplier = supplier_dv
        elif supplier_type == '31':
            scheme_id_supplier = supplier_type  # Fallback solo para NIT
        else:
            scheme_id_supplier = ''  # No residentes: sin DV
        supplier_company_id_attrs.update({
            'schemeID': scheme_id_supplier,
            'schemeName': supplier_type
        })

        self.placeholder_for('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme')
        
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:RegistrationName',
                          invoice.invoice_supplier.legal_name)
        
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID',
                          invoice.invoice_supplier.ident,
                          **supplier_company_id_attrs)
        
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:TaxLevelCode',
                          invoice.invoice_supplier.responsability_code,
                          listName=invoice.invoice_supplier.responsability_regime_code)

        self.placeholder_for('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme')
        
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID',
                          invoice.invoice_supplier.tax_scheme.code)
        
        self.set_element('./cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name',
                          invoice.invoice_supplier.tax_scheme.name)

        # ❌ ELIMINADOS (Anexo v1.1, pág 12-13):
        # - PartyLegalEntity -> NO SE INCLUYE
        # - Contact -> NO SE INCLUYE

    def set_customer(self, invoice):
        """
        CUSTOMER = Adquirente ABS (quien genera el documento)
        
        Según Anexo v1.1, Sección 5 (Control de Versiones, pág 12-13):
        SE ELIMINARON de AccountingCustomerParty:
        - PhysicalLocation
        - Contact
        
        ESTRUCTURA PERMITIDA:
        - AdditionalAccountID (Tipo persona)
        - Party/PartyTaxScheme (Datos fiscales con RegistrationAddress)
        - Party/PartyLegalEntity (Registro mercantil) ✓ MANTENIDO para Customer
        """
        self.placeholder_for('./cac:AccountingCustomerParty')
        
        # DSAK02: AdditionalAccountID (pág 39)
        self.set_element('./cac:AccountingCustomerParty/cbc:AdditionalAccountID',
                          invoice.invoice_customer.organization_code)

        # ❌ PhysicalLocation -> ELIMINADO (no se incluye)
        
        # DSAK19-DSAK40: PartyTaxScheme
        customer_company_id_attrs = fe.SCHEME_AGENCY_ATTRS.copy()
        scheme_id_customer = invoice.invoice_customer.ident.dv if invoice.invoice_customer.ident.dv else invoice.invoice_customer.ident.type_fiscal
        customer_company_id_attrs.update({
            'schemeID': scheme_id_customer,
            'schemeName': invoice.invoice_customer.ident.type_fiscal
        })

        self.placeholder_for('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme')
        
        # DSAK20: RegistrationName
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:RegistrationName',
                          invoice.invoice_customer.legal_name)
        
        # DSAK21: CompanyID
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID',
                          invoice.invoice_customer.ident,
                          **customer_company_id_attrs)

        # DSAK26: TaxLevelCode
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:TaxLevelCode',
                          invoice.invoice_customer.responsability_code,
                          listName=invoice.invoice_customer.responsability_regime_code)

        # DSAK27-DSAK38: RegistrationAddress (Dirección fiscal en TaxScheme)
        self.placeholder_for('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress')
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:ID',
                          invoice.invoice_customer.address.city.code)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:CityName',
                          invoice.invoice_customer.address.city.name)
        
        # DSAK73: PostalZone - Código postal de 6 dígitos según lista DIAN
        postal_zone_customer = invoice.invoice_customer.address.postal_code or (invoice.invoice_customer.address.city.code + '00')
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:PostalZone',
                          postal_zone_customer)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:CountrySubentity',
                          invoice.invoice_customer.address.countrysubentity.name)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:CountrySubentityCode',
                          invoice.invoice_customer.address.countrysubentity.code)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cac:AddressLine/cbc:Line',
                          invoice.invoice_customer.address.street)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cac:Country/cbc:IdentificationCode',
                          invoice.invoice_customer.address.country.code)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:RegistrationAddress/cac:Country/cbc:Name', 
                          invoice.invoice_customer.address.country.name,
                          languageID='es')

        # DSAK39-DSAK40: TaxScheme
        self.placeholder_for('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme')
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID',
                          invoice.invoice_customer.tax_scheme.code)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name',
                          invoice.invoice_customer.tax_scheme.name)

        # DSAK42-DSAK48: PartyLegalEntity (✓ MANTENIDO para Customer)
        self.placeholder_for('./cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity')
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName',
                          invoice.invoice_customer.legal_name)
        
        self.set_element('./cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID',
                          invoice.invoice_customer.ident,
                          **customer_company_id_attrs)

        # ❌ ELIMINADOS (Anexo v1.1):
        # - Contact -> NO SE INCLUYE

    def set_invoice_lines(self, invoice):
        """
        Sobrescribir para agregar InvoicePeriod a cada línea según DSFC01-DSFC04
        Según Anexo Técnico v1.1, el InvoicePeriod es OBLIGATORIO en cada InvoiceLine
        
        Validaciones de fecha según Anexo Técnico:
        - DescriptionCode='1' (Por operación): StartDate DEBE ser igual al SigningTime (fecha de emisión)
        - DescriptionCode='2' (Acumulado semanal): StartDate puede ser hasta 6 días antes del SigningTime
        """
        from datetime import timedelta
        
        next_append = False
        for index, invoice_line in enumerate(invoice.invoice_lines):
            line = self.fragment('./cac:%sLine' % (self.tag_document()), append=next_append)
            next_append = True

            line.set_element('./cbc:ID', index + 1)
            line.set_element('./cbc:%sQuantity' % (self.tag_document_concilied()), invoice_line.quantity, unitCode=invoice_line.quantity.code)
            self.set_element_amount_for(line,
                                         './cbc:LineExtensionAmount',
                                         invoice_line.total_amount)

            # DSFC01-DSFC04: InvoicePeriod OBLIGATORIO en cada línea (Anexo v1.1, pág 58)
            # Determinar fecha de inicio según description_code
            description_code = getattr(invoice_line, 'description_code', '1') or '1'
            period_start = getattr(invoice_line, 'period_start_date', None)
            
            # Si no se especifica fecha, usar la fecha de emisión del documento
            if period_start is None:
                period_start = invoice.invoice_period_start
            
            # Validar fechas según DescriptionCode (Reglas del Anexo Técnico)
            signing_date = invoice.invoice_period_start
            if description_code == '1':
                # Por operación: StartDate DEBE ser igual a SigningTime
                # Si no coincide, forzar a la fecha de emisión
                if period_start != signing_date:
                    period_start = signing_date
            elif description_code == '2':
                # Acumulado semanal: StartDate puede ser hasta 6 días antes
                min_allowed_date = signing_date - timedelta(days=6)
                if period_start < min_allowed_date:
                    raise ValueError(
                        f"InvoicePeriod StartDate ({period_start}) excede los 6 días permitidos "
                        f"para DescriptionCode='2'. Fecha mínima permitida: {min_allowed_date}"
                    )
                if period_start > signing_date:
                    raise ValueError(
                        f"InvoicePeriod StartDate ({period_start}) no puede ser posterior "
                        f"a la fecha de emisión ({signing_date})"
                    )
            
            # Descripción según código
            description_map = {
                '1': 'Por operación',
                '2': 'Acumulado semanal'
            }
            description_text = description_map.get(description_code, 'Por operación')
            
            # Tabla 16.1.6: DescriptionCode: 1=Por operación, 2=Acumulado semanal
            line.set_element('./cac:InvoicePeriod/cbc:StartDate', 
                             period_start.strftime('%Y-%m-%d'))
            # DSFC03: DescriptionCode según tabla 16.1.6 (1=Por operación, 2=Acumulado semanal)
            line.set_element('./cac:InvoicePeriod/cbc:DescriptionCode', description_code)
            # DSFC04: Description según tabla 16.1.6
            line.set_element('./cac:InvoicePeriod/cbc:Description', description_text)

            if not isinstance(invoice_line.tax, TaxTotalOmit):
                self.set_invoice_line_tax(line, invoice_line)

            line.set_element('./cac:Item/cbc:Description', invoice_line.item.description)

            # Configurar StandardItemIdentification con atributos
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

            line.set_element('./cac:Price/cbc:PriceAmount', invoice_line.price.amount, currencyID=invoice_line.price.amount.currency.code)
            line.set_element('./cac:Price/cbc:BaseQuantity',
                             invoice_line.price.quantity,
                             unitCode=invoice_line.quantity.code)

            for idx, charge in enumerate(invoice_line.allowance_charge):
                next_append_charge = idx > 0
                self.append_allowance_charge(line, index + 1, charge, append=next_append_charge)

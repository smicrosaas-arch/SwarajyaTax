/**
 * Reconciliation Engine
 * Compares two sets of GST return data and identifies mismatches
 */

function reconcileReturns(data1, data2) {
    const mismatches = [];
    const invoices1 = data1.invoices || [];
    const invoices2 = data2.invoices || [];

    // Index invoices from data2 by invoice number
    const invoiceMap2 = {};
    for (const inv of invoices2) {
        const key = `${inv.invoiceNo || inv.invoice_no}_${inv.supplierGstin || inv.supplier_gstin || ''}`;
        invoiceMap2[key] = inv;
    }

    // Compare each invoice from data1 against data2
    for (const inv1 of invoices1) {
        const invNo = inv1.invoiceNo || inv1.invoice_no;
        const supplierGstin = inv1.supplierGstin || inv1.supplier_gstin || '';
        const key = `${invNo}_${supplierGstin}`;
        const inv2 = invoiceMap2[key];

        if (!inv2) {
            mismatches.push({
                invoiceNo: invNo,
                supplierGstin,
                field: 'invoice_missing',
                filed: invNo,
                matched: 'NOT_FOUND',
                difference: 'Invoice present in filed return but missing in matched return'
            });
            continue;
        }

        // Compare numeric fields
        const fieldsToCompare = [
            { key: 'taxableValue', alt: 'taxable_value' },
            { key: 'igst', alt: 'igst' },
            { key: 'cgst', alt: 'cgst' },
            { key: 'sgst', alt: 'sgst' },
            { key: 'cess', alt: 'cess' },
            { key: 'totalValue', alt: 'total_value' }
        ];

        for (const field of fieldsToCompare) {
            const val1 = Number(inv1[field.key] || inv1[field.alt] || 0);
            const val2 = Number(inv2[field.key] || inv2[field.alt] || 0);

            if (Math.abs(val1 - val2) > 0.01) {
                mismatches.push({
                    invoiceNo: invNo,
                    supplierGstin,
                    field: field.key,
                    filed: val1,
                    matched: val2,
                    difference: Math.round((val1 - val2) * 100) / 100
                });
            }
        }

        // Remove from map to track extra invoices in data2
        delete invoiceMap2[key];
    }

    // Invoices in data2 but not in data1
    for (const key of Object.keys(invoiceMap2)) {
        const inv2 = invoiceMap2[key];
        mismatches.push({
            invoiceNo: inv2.invoiceNo || inv2.invoice_no,
            supplierGstin: inv2.supplierGstin || inv2.supplier_gstin || '',
            field: 'invoice_extra',
            filed: 'NOT_FOUND',
            matched: inv2.invoiceNo || inv2.invoice_no,
            difference: 'Invoice present in matched return but missing in filed return'
        });
    }

    return mismatches;
}

module.exports = { reconcileReturns };

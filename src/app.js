const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const puppeteer = require('puppeteer');
const numeral = require('numeral');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// helper to format currency
function fmt(n) {
  return '₹ ' + numeral(n).format('0,0.00');
}

// Show form
app.get('/', (req, res) => {
  res.render('invoice-form', { moment });
});

// Render invoice HTML (viewable in browser)
app.post('/invoice', (req, res) => {
  const data = req.body;

  // parse line items (ensure array)
  const items = Array.isArray(data.description)
    ? data.description.map((desc, i) => ({
        description: desc,
        hsn: data.hsn[i] || '',
        qty: Number(data.qty[i] || 0),
        price: Number(data.price[i] || 0),
        taxRate: Number(data.taxRate ? data.taxRate[i] || 0 : 0),
      }))
    : [{
        description: data.description || '',
        hsn: data.hsn || '',
        qty: Number(data.qty || 0),
        price: Number(data.price || 0),
        taxRate: Number(data.taxRate || 0)
      }];

  // Calculate amounts and taxes per item
  items.forEach(it => {
    it.taxable = it.qty * it.price;
    it.taxAmount = +(it.taxable * (it.taxRate / 100)).toFixed(2);
    it.total = +(it.taxable + it.taxAmount).toFixed(2);
    it.percentage = it.qty && it.price ? +((it.taxable / 100) * 100).toFixed(2) : 0;
  });

  // totals
  const subTotal = items.reduce((s, i) => s + i.taxable, 0);
  const totalTax = items.reduce((s, i) => s + i.taxAmount, 0);
  const grandTotal = +(subTotal + totalTax).toFixed(2);

  const invoice = {
    invoiceNo: data.invoiceNo || `INV-${Date.now()}`,
    date: data.date || moment().format('DD-MMM-YYYY'),
    dueDate: data.dueDate || moment().add(15, 'days').format('DD-MMM-YYYY'),
    company: {
      name: data.companyName || 'AK ENTERPRISES',
      addressLine1: data.address1 || 'Plot No. ...',
      addressLine2: data.address2 || '',
      gstin: data.gstin || '',
      phone: data.companyPhone || ''
    },
    customer: {
      name: data.customerName || '',
      address: data.customerAddress || '',
      gstin: data.customerGstin || ''
    },
    items,
    subTotal,
    totalTax,
    grandTotal,
    bank: {
      name: data.bankName || '',
      account: data.bankAccount || '',
      ifsc: data.bankIfsc || ''
    }
  };

  res.render('invoice', { invoice, fmt, moment });
});

// Generate PDF and send as attachment
app.post('/invoice/pdf', async (req, res) => {
  try {
    const html = await new Promise((resolve, reject) => {
      // render the EJS template to HTML string
      const data = req.body;
      const items = Array.isArray(data.description)
        ? data.description.map((desc, i) => ({
            description: desc,
            hsn: data.hsn[i] || '',
            qty: Number(data.qty[i] || 0),
            price: Number(data.price[i] || 0),
            taxRate: Number(data.taxRate ? data.taxRate[i] || 0 : 0),
          }))
        : [{
            description: data.description || '',
            hsn: data.hsn || '',
            qty: Number(data.qty || 0),
            price: Number(data.price || 0),
            taxRate: Number(data.taxRate || 0)
          }];

      items.forEach(it => {
        it.taxable = it.qty * it.price;
        it.taxAmount = +(it.taxable * (it.taxRate / 100)).toFixed(2);
        it.total = +(it.taxable + it.taxAmount).toFixed(2);
      });

      const subTotal = items.reduce((s, i) => s + i.taxable, 0);
      const totalTax = items.reduce((s, i) => s + i.taxAmount, 0);
      const grandTotal = +(subTotal + totalTax).toFixed(2);

      const invoice = {
        invoiceNo: data.invoiceNo || `INV-${Date.now()}`,
        date: data.date || moment().format('DD-MMM-YYYY'),
        dueDate: data.dueDate || moment().add(15, 'days').format('DD-MMM-YYYY'),
        company: {
          name: data.companyName || 'AK ENTERPRISES',
          addressLine1: data.address1 || '',
          addressLine2: data.address2 || '',
          gstin: data.gstin || '',
          phone: data.companyPhone || ''
        },
        customer: {
          name: data.customerName || '',
          address: data.customerAddress || '',
          gstin: data.customerGstin || ''
        },
        items,
        subTotal,
        totalTax,
        grandTotal,
        bank: {
          name: data.bankName || '',
          account: data.bankAccount || '',
          ifsc: data.bankIfsc || ''
        }
      };

      app.render('invoice', { invoice, fmt, moment }, (err, out) => {
        if (err) return reject(err);
        resolve(out);
      });
    });

    // Launch puppeteer and create PDF
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `attachment; filename=${req.body.invoiceNo || 'invoice'}.pdf`
    });

    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating PDF');
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
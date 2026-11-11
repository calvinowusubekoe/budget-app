import PDFDocument from 'pdfkit';
import { D } from '../../utils/money.js';

const isZero = (v) => new D(v).isZero();

/*
 * PDF output with pdfkit's built-in Helvetica. It has no glyph for some
 * currency symbols (e.g. ₵), so amounts are printed with ISO codes: "GHS 1,250.00".
 */

const INK = '#14212A';
const MUTED = '#4B5B66';
const LAGOON = '#0F6B66';

/** Groups digits of a decimal string without converting it to a float. */
export function money(amount, currency) {
  const neg = String(amount).startsWith('-');
  const [int, frac] = String(amount).replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency} ${grouped}${frac ? `.${frac}` : ''}`;
}

function toBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Producer: 'BudgetFlow', Creator: 'BudgetFlow' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const fmtDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** An invoice or bill as a printable document. */
export function documentPdf(d, business) {
  return toBuffer((doc) => {
    const isInvoice = d.kind === 'invoice';
    doc.fillColor(LAGOON).fontSize(22).font('Helvetica-Bold').text(isInvoice ? 'Invoice' : 'Bill', 50, 50);
    doc.fillColor(INK).fontSize(11).font('Helvetica').text(d.number, 50, 78);
    if (d.reference) doc.fillColor(MUTED).text(`Supplier reference: ${d.reference}`);
    if (d.status === 'void') doc.fillColor('#B4483C').font('Helvetica-Bold').text('VOID', 400, 50, { width: 145, align: 'right' }).font('Helvetica');

    doc.fillColor(INK).fontSize(10);
    const from = isInvoice ? business : { name: d.party?.name ?? '' };
    const to = isInvoice ? { name: d.party?.name ?? '' } : business;
    doc.font('Helvetica-Bold').text('From', 50, 120).font('Helvetica').text(from.name).text(from.extra ?? '', { width: 220 });
    doc.font('Helvetica-Bold').text('To', 300, 120).font('Helvetica').text(to.name, 300).text(to.extra ?? '', 300, undefined, { width: 245 });
    doc.font('Helvetica-Bold').text('Issued', 50, 190).font('Helvetica').text(fmtDate(d.issueDate), 110, 190);
    doc.font('Helvetica-Bold').text('Due', 50, 205).font('Helvetica').text(fmtDate(d.dueDate), 110, 205);

    let y = 245;
    const cols = [50, 300, 360, 440];
    doc.font('Helvetica-Bold').fillColor(MUTED);
    doc.text('Description', cols[0], y).text('Qty', cols[1], y, { width: 50, align: 'right' }).text('Unit price', cols[2], y, { width: 75, align: 'right' }).text('Amount', cols[3], y, { width: 105, align: 'right' });
    y += 16;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#D5DCE2').stroke();
    y += 6;
    doc.font('Helvetica').fillColor(INK);
    for (const l of d.lines) {
      const h = Math.max(doc.heightOfString(l.description, { width: 240 }), 12);
      if (y + h > 720) {
        doc.addPage();
        y = 50;
      }
      doc.text(l.description, cols[0], y, { width: 240 });
      doc.text(l.quantity, cols[1], y, { width: 50, align: 'right' });
      doc.text(money(l.unitPrice, d.currency), cols[2], y, { width: 75, align: 'right' });
      doc.text(money(l.amount, d.currency), cols[3], y, { width: 105, align: 'right' });
      if (l.taxRate) doc.fillColor(MUTED).fontSize(8).text(`tax ${l.taxRate}%: ${money(l.tax, d.currency)}`, cols[3], y + 12, { width: 105, align: 'right' }).fontSize(10).fillColor(INK);
      y += h + (l.taxRate ? 18 : 8);
    }
    y += 6;
    doc.moveTo(300, y).lineTo(545, y).strokeColor('#D5DCE2').stroke();
    y += 8;
    const row = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 300, y, { width: 130 }).text(value, 430, y, { width: 115, align: 'right' });
      y += 16;
    };
    row('Subtotal', money(d.subtotal, d.currency));
    if (!isZero(d.taxTotal)) row('Tax', money(d.taxTotal, d.currency));
    row('Total', money(d.total, d.currency), true);
    if (!isZero(d.paid)) row('Paid', money(d.paid, d.currency));
    row(isInvoice ? 'Balance due' : 'Balance to pay', money(d.balance, d.currency), true);

    y += 16;
    if (d.terms) doc.font('Helvetica-Bold').fillColor(INK).text('Terms', 50, y).font('Helvetica').text(d.terms, { width: 495 });
    if (d.notes) doc.moveDown().font('Helvetica-Bold').text('Notes').font('Helvetica').text(d.notes, { width: 495 });
    doc.fontSize(8).fillColor(MUTED).text('Prepared with BudgetFlow, a record-keeping tool. BudgetFlow does not process payments.', 50, 780, { width: 495, align: 'center' });
  });
}

/** Profit and loss statement. */
export function profitLossPdf(pl, business) {
  return toBuffer((doc) => {
    const c = pl.currency;
    doc.fillColor(LAGOON).fontSize(20).font('Helvetica-Bold').text('Profit and loss', 50, 50);
    doc.fillColor(INK).fontSize(11).font('Helvetica').text(business.name);
    doc.fillColor(MUTED).text(`${fmtDate(pl.period.from)} to ${fmtDate(pl.period.to)}`);
    let y = 130;
    const section = (title, rows, total) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(title, 50, y);
      y += 20;
      doc.font('Helvetica').fontSize(10);
      for (const r of rows) {
        doc.text(r.name, 60, y, { width: 300 }).text(money(r.amount, c), 380, y, { width: 165, align: 'right' });
        y += 15;
      }
      if (!rows.length) {
        doc.fillColor(MUTED).text('None recorded', 60, y).fillColor(INK);
        y += 15;
      }
      doc.moveTo(380, y).lineTo(545, y).strokeColor('#D5DCE2').stroke();
      y += 5;
      doc.font('Helvetica-Bold').text(`Total ${title.toLowerCase()}`, 60, y).text(money(total, c), 380, y, { width: 165, align: 'right' });
      y += 28;
    };
    section('Income', pl.income.byCategory, pl.income.total);
    section('Expenses', pl.expenses.byCategory, pl.expenses.total);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(pl.netProfit.startsWith('-') ? '#B4483C' : LAGOON).text(pl.netProfit.startsWith('-') ? 'Net loss' : 'Net profit', 50, y).text(money(pl.netProfit, c), 380, y, { width: 165, align: 'right' });
    y += 22;
    if (pl.margin) doc.fontSize(10).font('Helvetica').fillColor(MUTED).text(`Margin: ${pl.margin}% of income`, 50, y);
    y += 30;
    doc.fontSize(10).fillColor(MUTED).text(`Previous period (${fmtDate(pl.previousPeriod.from)} to ${fmtDate(pl.previousPeriod.to)}): income ${money(pl.previous.income, c)}, expenses ${money(pl.previous.expenses, c)}, net ${money(pl.previous.netProfit, c)}.`, 50, y, { width: 495 });
    doc.fontSize(8).text(pl.note, 50, 780, { width: 495, align: 'center' });
  });
}

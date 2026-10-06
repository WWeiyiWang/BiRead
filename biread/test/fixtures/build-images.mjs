import fs from 'node:fs';
const pixels=Array.from({length:16*16},(_,i)=>i%16<8?'FF0000':'0000FF').join('')+'>';
const content='BT /F1 18 Tf 60 740 Td (Embedded image test) Tj ET\nq 160 0 0 120 60 500 cm /Im1 Do Q\nBT /F1 12 Tf 60 480 Td (Figure 1: Red and blue blocks) Tj ET\nq 120 0 0 160 340 200 cm /Im1 Do Q\nBT /F1 12 Tf 60 100 Td (Selectable body text remains available.) Tj ET';
const objects=[
'<< /Type /Catalog /Pages 2 0 R >>',
'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>',
'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
'<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream',
'<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length '+pixels.length+' >>\nstream\n'+pixels+'\nendstream'];
let pdf='%PDF-1.4\n', offsets=[0];
objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
const start=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('');pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';
fs.writeFileSync(new URL('./images.pdf',import.meta.url),pdf);

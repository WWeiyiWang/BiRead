const fs = require('fs');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const out=__dirname + '/';
const left='M 64 108 C 64 93 77 88 93 92 C 147 104 197 133 243 177 L 243 448 C 207 425 158 405 107 392 C 76 384 64 370 64 344 L 64 285 C 64 265 69 253 82 244 C 68 235 64 223 64 206 Z';
const top='M 76 54 C 113 55 200 90 243 150 C 194 113 135 84 76 76 C 73 67 73 61 76 54 Z';
function mark(small=false,dark=false){
 const a=dark?'#EAD9B7':'#CDBA9D', b=dark?'#F8F1E6':'#3B3B3B';
 const hole='M 124 205 L 188 235 M 124 275 L 188 305';
 return `<defs><mask id="cut"><rect width="512" height="512" fill="white"/><path d="${hole}" fill="none" stroke="black" stroke-width="${small?24:20}" stroke-linecap="round"/><path d="${hole}" transform="translate(512 0) scale(-1 1)" fill="none" stroke="black" stroke-width="${small?24:20}" stroke-linecap="round"/></mask></defs><g mask="url(#cut)"><path fill="${a}" d="${left}"/><path fill="${b}" d="${left}" transform="translate(512 0) scale(-1 1)"/></g>${small?'':`<path fill="#EAD9B7" d="${top}"/><path fill="#CDBA9D" d="${top}" transform="translate(512 0) scale(-1 1)"/>`}`;
}
const svg=(w,h,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="BiRead">${body}</svg>`;
async function main(){
 const icon=svg(512,512,mark());
 const small=svg(512,512,mark(true));
 const dark=svg(512,512,mark(false,true));
 const word=svg(1200,360,`<g transform="translate(0 4) scale(.68)">${mark()}</g><text x="386" y="237" font-family="Segoe UI, Arial, sans-serif" font-size="174" font-weight="600" letter-spacing="-6" fill="#3B3B3B">BiRead</text>`);
 for(const [name,s] of [['biread-icon',icon],['biread-icon-small',small],['biread-icon-dark',dark],['biread-wordmark',word]]){fs.writeFileSync(out+name+'.svg',s);await sharp(Buffer.from(s)).png().toFile(out+name+'.png');}
 for(const size of [16,32,48,64,96,128,256]) await sharp(Buffer.from(size<=32?small:icon)).resize(size,size).png().toFile(out+`biread-icon-${size}.png`);
 const thumb=(data)=>'data:image/svg+xml;base64,'+Buffer.from(data).toString('base64');
 const preview=svg(1400,880,`<rect width="1400" height="880" fill="#F8F1E6"/><text x="72" y="66" font-family="Segoe UI,Arial" font-size="18" letter-spacing="4" fill="#3B3B3B">BiRead / BRAND ASSETS</text><image href="${thumb(icon)}" x="84" y="104" width="380" height="380"/><image href="${thumb(word)}" x="558" y="164" width="770" height="231"/><path d="M72 524H1328" stroke="#C9B89A" stroke-opacity=".45"/><text x="72" y="578" font-family="Segoe UI,Arial" font-size="16" letter-spacing="3" fill="#3B3B3B">SMALL-SIZE ICONS</text>${[16,32,48,64,96,128].map((n,i)=>`<image href="${thumb(n<=32?small:icon)}" x="${90+i*150}" y="${682-n/2}" width="${n}" height="${n}"/><text x="${90+i*150}" y="794" font-family="Segoe UI,Arial" font-size="16" fill="#3B3B3B">${n} px</text>`).join('')}<rect x="1120" y="602" width="184" height="184" rx="36" fill="#3B3B3B"/><image href="${thumb(dark)}" x="1132" y="614" width="160" height="160"/>`);
 await sharp(Buffer.from(preview)).png().toFile(out+'preview.png');
}
main();


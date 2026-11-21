function shorten(line, limit) {
  const letters=Array.from(String(line));
  return letters.length>limit ? `${letters.slice(0,Math.max(1,limit-1)).join('')}…` : line;
}
export function formatEventPreview(event={},width=80) {
  const max=Math.max(10,Math.floor(width)-10);
  const text=String(event.detail||'').replace(/\t/g,'  ').trim();
  if(!text)return {lines:[],hint:''};
  const rawLines=text.split(/\r?\n/).filter(Boolean);
  const lines=rawLines.slice(0,2).map(line=>shorten(line,max));
  const reduced=rawLines.length>2 || lines.some((line,i)=>line!==rawLines[i]);
  return {lines,hint:reduced?'↳ /transcript · full output':''};
}

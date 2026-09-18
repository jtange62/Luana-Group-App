export function schoolYear(date = new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})) {
  return Number(date.slice(0,4)) - (Number(date.slice(5,7)) < 4 ? 1 : 0);
}
export function validYear(value) { return /^\d{4}$/.test(String(value)) && Number(value)>=2000 && Number(value)<=2100; }
export function requestedYear(value) { return value == null || value === '' ? schoolYear() : validYear(value) ? Number(value) : null; }
export function shiftDate(date, years) {
  if (!date) return date;
  const [y,m,d]=date.split('-').map(Number),year=y+years;
  const last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return year+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0');
}

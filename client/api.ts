const configured=import.meta.env.VITE_API_URL as string|undefined;
export const apiBase=configured?new URL(configured).origin:location.origin;
export const apiURL=(path:string)=>new URL(path,apiBase).href;
export const socketURL=()=>apiURL('/api/events').replace(/^http/,'ws');

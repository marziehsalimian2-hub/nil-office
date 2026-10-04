const tail = (v: string, n = 4) => (v.length <= n ? v : "•".repeat(v.length - n) + v.slice(-n));

export const maskIban = (v: string | null) => (v ? "IR" + tail(v.slice(2)) : null);
export const maskAccount = (v: string | null) => (v ? tail(v) : null);
export const maskCard = (v: string | null) => (v ? tail(v) : null);

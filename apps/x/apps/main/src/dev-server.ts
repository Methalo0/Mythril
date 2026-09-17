// Dev-mode renderer URL. Overridable so a second checkout (whose vite falls
// back to another port when 5173 is taken) can still be launched against its
// own renderer: MYTHRIL_DEV_SERVER_URL=http://localhost:5174 electron .
export const DEV_SERVER_URL = process.env.MYTHRIL_DEV_SERVER_URL ?? "http://localhost:5173";

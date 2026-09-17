import { z } from "zod";
import { MythrilApiConfig } from "@x/shared/dist/mythril-account.js";
import { API_URL } from "./env.js";

let cached: z.infer<typeof MythrilApiConfig> | null = null;

export async function getMythrilConfig(): Promise<z.infer<typeof MythrilApiConfig>> {
  if (cached) {
    return cached;
  }
  const response = await fetch(`${API_URL}/v1/config`);
  const data = MythrilApiConfig.parse(await response.json());
  cached = data;
  return data;
}
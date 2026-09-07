/**
 * Values come from EAS environment variables at build time, or from .env
 * during local development. No secret is committed.
 */
export const CREDENTIALS = {
  username: process.env.EXPO_PUBLIC_TB_USERNAME ?? '',
  password: process.env.EXPO_PUBLIC_TB_PASSWORD ?? '',
};

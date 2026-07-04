if (!process.env.ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_PASSWORD must be set. Did you forget to configure this secret?",
  );
}

if (!process.env.SUB_ADMIN_PASSWORD) {
  throw new Error(
    "SUB_ADMIN_PASSWORD must be set. Did you forget to configure this secret?",
  );
}

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const SUB_ADMIN_PASSWORD_DEFAULT = process.env.SUB_ADMIN_PASSWORD;

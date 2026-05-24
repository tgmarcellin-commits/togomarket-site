import { Router, type IRouter } from "express";
import { VerifyAdminBody, VerifyAdminResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

router.post("/admin/verify", async (req, res): Promise<void> => {
  const parsed = VerifyAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const success = parsed.data.password === ADMIN_PASSWORD;
  res.json(VerifyAdminResponse.parse({ success }));
});

export default router;

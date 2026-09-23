import { Router, type IRouter } from "express";
import { db, ordersTable } from "@workspace/db";
import { CreateOrderBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid order body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [order] = await db
    .insert(ordersTable)
    .values({
      lastName: parsed.data.lastName,
      firstName: parsed.data.firstName,
      phone: parsed.data.phone,
      description: parsed.data.description,
    })
    .returning();

  req.log.info({ id: order.id }, "Order created");

  res.status(201).json({
    id: order.id,
    lastName: order.lastName,
    firstName: order.firstName,
    phone: order.phone,
    description: order.description,
    createdAt: order.createdAt.toISOString(),
  });
});

export default router;

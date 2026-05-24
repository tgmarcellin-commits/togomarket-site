import { Router, type IRouter } from "express";
import { db, listingsTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";
import { GetStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const bySectorRows = await db
    .select({
      sector: listingsTable.sector,
      count: count(),
    })
    .from(listingsTable)
    .groupBy(listingsTable.sector);

  const total = bySectorRows.reduce((acc, row) => acc + Number(row.count), 0);

  res.json(GetStatsResponse.parse({
    total,
    bysector: bySectorRows.map((r) => ({
      sector: r.sector,
      count: Number(r.count),
    })),
  }));
});

export default router;

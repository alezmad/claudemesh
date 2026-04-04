import { Hono } from "hono";

import { enforceAdmin, enforceAuth } from "../../middleware";

import { auditRouter } from "./audit/router";
import { getMessages24hCount } from "./audit/queries";
import { getCustomersCount } from "./customers/queries";
import { customersRouter } from "./customers/router";
import { invitesRouter } from "./invites/router";
import {
  getActiveMeshesCount,
  getMeshesCount,
} from "./meshes/queries";
import { meshesRouter } from "./meshes/router";
import { getOrganizationsCount } from "./organizations/queries";
import { organizationsRouter } from "./organizations/router";
import {
  getActivePresencesCount,
  getPresencesCount,
} from "./sessions/queries";
import { sessionsRouter } from "./sessions/router";
import { getUsersCount } from "./users/queries";
import { usersRouter } from "./users/router";

export const adminRouter = new Hono()
  .use(enforceAuth)
  .use(enforceAdmin)
  .route("/users", usersRouter)
  .route("/organizations", organizationsRouter)
  .route("/customers", customersRouter)
  .route("/meshes", meshesRouter)
  .route("/sessions", sessionsRouter)
  .route("/invites", invitesRouter)
  .route("/audit", auditRouter)
  .get("/summary", async (c) => {
    const [users, organizations, customers] = await Promise.all([
      getUsersCount(),
      getOrganizationsCount(),
      getCustomersCount(),
    ]);

    return c.json({ users, organizations, customers });
  })
  .get("/summary/mesh", async (c) => {
    const [meshes, activeMeshes, totalPresences, activePresences, messages24h] =
      await Promise.all([
        getMeshesCount(),
        getActiveMeshesCount(),
        getPresencesCount(),
        getActivePresencesCount(),
        getMessages24hCount(),
      ]);

    return c.json({
      meshes,
      activeMeshes,
      totalPresences,
      activePresences,
      messages24h,
    });
  });

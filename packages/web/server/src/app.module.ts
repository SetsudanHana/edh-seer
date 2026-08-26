import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AnalyzeController } from "./analyze/analyze.controller.js";
import { AnalyzeService } from "./analyze/analyze.service.js";
import { CalibrateController } from "./calibrate/calibrate.controller.js";
import { CalibrateService } from "./calibrate/calibrate.service.js";
import { calibrateEnabled } from "./calibrate/enabled.js";
import { DataModule } from "./data/data.module.js";

// READ ONCE, AT MODULE LOAD, so the route table cannot change under a running server — a flag that
// could be flipped mid-process is a second thing to reason about and buys nothing here.
const CALIBRATE = calibrateEnabled();

@Module({
  imports: [DataModule],
  // NOT MOUNTED BY DEFAULT: the verdict route WRITES the panel's own inputs. Unmounted means the
  // routes 404 — there is no handler to reach, rather than a handler that checks a flag, which is
  // the difference between an endpoint that cannot run and one that is one bug away from running.
  controllers: [HealthController, AnalyzeController, ...(CALIBRATE ? [CalibrateController] : [])],
  providers: [AnalyzeService, ...(CALIBRATE ? [CalibrateService] : [])],
})
export class AppModule {}

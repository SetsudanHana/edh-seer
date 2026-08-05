import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AnalyzeController } from "./analyze/analyze.controller.js";
import { AnalyzeService } from "./analyze/analyze.service.js";
import { CalibrateController } from "./calibrate/calibrate.controller.js";
import { CalibrateService } from "./calibrate/calibrate.service.js";
import { DataModule } from "./data/data.module.js";

@Module({
  imports: [DataModule],
  controllers: [HealthController, AnalyzeController, CalibrateController],
  providers: [AnalyzeService, CalibrateService],
})
export class AppModule {}

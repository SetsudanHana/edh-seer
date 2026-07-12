import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AnalyzeController } from "./analyze/analyze.controller.js";
import { AnalyzeService } from "./analyze/analyze.service.js";
import { ANALYZE_DEPS } from "./analyze/analyze.service.js";

@Module({
  controllers: [HealthController, AnalyzeController],
  providers: [
    AnalyzeService,
    {
      provide: ANALYZE_DEPS,
      useValue: {
        parseDecklistText: () => {
          throw new Error("wired in Task 4");
        },
        makeLookup: () => {
          throw new Error("wired in Task 4");
        },
        resolveNames: async () => {
          throw new Error("wired in Task 4");
        },
        analyze: () => {
          throw new Error("wired in Task 4");
        },
      },
    },
  ],
})
export class AppModule {}

import { BadRequestException, Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { CalibrateService, type CalibratePair, type VerdictRequest } from "./calibrate.service.js";

const VERDICTS = new Set(["synergy", "neutral", "anti-synergy"]);
const STRATA = new Set(["linked", "shared-tag", "random"]);

@Controller("calibrate")
export class CalibrateController {
  constructor(private readonly service: CalibrateService) {}

  @Get("pair")
  async pair(): Promise<CalibratePair> {
    return this.service.pair();
  }

  @Post("verdict")
  @HttpCode(200)
  async verdict(@Body() body: VerdictRequest): Promise<{ total: number; knownDefects: number }> {
    // Validated rather than trusted: a typo'd verdict would be written to a file the test suite
    // reads, and a gate fed junk is worse than no gate.
    if (!body || typeof body.a !== "string" || typeof body.b !== "string" || body.a === body.b) {
      throw new BadRequestException("a and b must be two different card names");
    }
    if (!VERDICTS.has(body.verdict)) {
      throw new BadRequestException(`verdict must be one of: ${[...VERDICTS].join(", ")}`);
    }
    if (!STRATA.has(body.stratum)) {
      throw new BadRequestException(`stratum must be one of: ${[...STRATA].join(", ")}`);
    }
    return this.service.record(body);
  }
}

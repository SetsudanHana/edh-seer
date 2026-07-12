import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";
import { AnalyzeService } from "./analyze.service.js";
import type { AnalyzeRequest } from "./analyze.dto.js";
import type { AnalyzeResponse } from "./analyze.types.js";

@Controller("analyze")
export class AnalyzeController {
  constructor(private readonly service: AnalyzeService) {}

  @Post()
  @HttpCode(200)
  async analyze(@Body() body: AnalyzeRequest): Promise<AnalyzeResponse> {
    if (!body || typeof body.decklist !== "string" || body.decklist.trim() === "") {
      throw new BadRequestException("decklist must be a non-empty string");
    }
    return this.service.analyze(body.decklist);
  }
}

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { FastifyReply } from "fastify";

@Catch()
export class MongoUnreachableFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      reply.status(status).send(exception.getResponse());
      return;
    }

    const message = exception instanceof Error ? exception.message : "Internal error";
    if (message.includes("Cannot reach MongoDB")) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE).send({ statusCode: 503, message });
      return;
    }
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ statusCode: 500, message });
  }
}

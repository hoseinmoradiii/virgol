import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { AppModule } from "./modules/app/app.module";
import { SwaggerConfigInit } from "./config/swagger.config";

const cookieParser = require("cookie-parser");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()) ?? true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useStaticAssets(join(process.cwd(), "public"));
  app.use(cookieParser(process.env.COOKIE_SECRET ?? "default-cookie-secret"));

  app.getHttpAdapter().get("/health", (_req: any, res: any) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== "production") {
    SwaggerConfigInit(app);
  }

  await app.listen(port, "0.0.0.0", () => {
    console.log(`http://localhost:${port}`);
    console.log(`health: http://localhost:${port}/health`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`swagger: http://localhost:${port}/swagger`);
    }
  });
}

bootstrap();

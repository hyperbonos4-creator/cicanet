import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExogenaService } from './exogena.service';
import { ExogenaController } from './exogena.controller';
import { RolesGuard } from '../auth/guards';

/** Información exógena (medios magnéticos). Módulo hoja. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ExogenaController],
  providers: [ExogenaService, RolesGuard],
  exports: [ExogenaService],
})
export class ExogenaModule {}

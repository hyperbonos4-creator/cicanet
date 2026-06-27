import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentosService } from './documentos.service';
import { DocumentosController } from './documentos.controller';
import { RolesGuard } from '../auth/guards';

/** Gestión documental de soportes contables (adjuntos por entidad). Módulo hoja. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DocumentosController],
  providers: [DocumentosService, RolesGuard],
  exports: [DocumentosService],
})
export class DocumentosModule {}

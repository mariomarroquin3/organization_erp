import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Librerías de exportación pesadas: se cargan desde node_modules en el servidor
  serverExternalPackages: ['exceljs', 'jspdf', 'jspdf-autotable'],
  // La importación sube el Excel a una acción de servidor (tope 4 MB en la acción)
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};

export default nextConfig;

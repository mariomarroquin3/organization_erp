import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Librerías de exportación pesadas: se cargan desde node_modules en el servidor
  serverExternalPackages: ['exceljs', 'jspdf', 'jspdf-autotable'],
};

export default nextConfig;

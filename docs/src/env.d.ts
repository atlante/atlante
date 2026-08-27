/// <reference types="astro/client" />

import type { StarlightRouteData } from "@astrojs/starlight/route-data";

declare global {
  namespace App {
    interface Locals {
      starlightRoute: StarlightRouteData;
    }
  }
}

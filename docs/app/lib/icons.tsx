import { ArrowRightLeft, Binary, BookOpen, Boxes, Braces, Cloud, CloudDownload, Code, Crosshair, Database, DatabaseZap, FlaskConical, Globe, HeartPulse, ListOrdered, Network, Package, Palette, Pipette, Rocket, Route, ScanSearch, Server, ShieldCheck, SquareFunction, Terminal, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'

/** Icons that `icon:` in frontmatter and meta.json may name; a small map keeps the rest of lucide out of the bundle. */
export const icons: Record<string, ReactNode> = {
  ArrowRightLeft: <ArrowRightLeft />,
  Binary: <Binary />,
  BookOpen: <BookOpen />,
  Boxes: <Boxes />,
  Braces: <Braces />,
  Cloud: <Cloud />,
  CloudDownload: <CloudDownload />,
  Code: <Code />,
  Crosshair: <Crosshair />,
  Database: <Database />,
  DatabaseZap: <DatabaseZap />,
  FlaskConical: <FlaskConical />,
  Globe: <Globe />,
  HeartPulse: <HeartPulse />,
  ListOrdered: <ListOrdered />,
  Network: <Network />,
  Package: <Package />,
  Palette: <Palette />,
  Pipette: <Pipette />,
  Rocket: <Rocket />,
  Route: <Route />,
  ScanSearch: <ScanSearch />,
  Server: <Server />,
  ShieldCheck: <ShieldCheck />,
  SquareFunction: <SquareFunction />,
  Terminal: <Terminal />,
  Workflow: <Workflow />,
}

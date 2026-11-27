import { use, type ComponentProps } from 'react'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsBody, DocsPage, MarkdownCopyButton, PageLastUpdate, ViewOptionsPopover } from 'fumadocs-ui/layouts/docs/page'
import type { Route } from './+types/docs'
import { OpenAPIPage } from '@/components/api-page'
import { DocsBar } from '@/components/docs-bar'
import { useMDXComponents } from '@/components/mdx'
import { SiteHeader } from '@/components/site-header'
import { layoutOptions } from '@/lib/layout.shared'
import { openapi } from '@/lib/openapi.server'
import { docsBase, pageImageUrl, pageMarkdownUrl, repository, repositoryUrl, siteOrigin } from '@/lib/shared'
import { docs, source } from '@/lib/source'
import { localeOf } from '@/lib/urls'

export async function loader({ params, request }: Route.LoaderArgs) {
  const locale = localeOf(new URL(request.url).pathname, docsBase)
  const slugs = params['*'].split('/').filter(segment => segment.length > 0)
  const page = source.getPage(slugs, locale)
  if (!page) throw new Response('Not found', { status: 404 })
  const { lastModified } = await page.data.load()
  // Generated API pages carry `_openapi`; their schema is resolved here so the browser never parses the spec file.
  const openapiData = '_openapi' in page.data && page.data._openapi ? await openapi.preloadOpenAPIPage(page) : null
  return {
    openapiData,
    locale,
    path: page.path,
    url: page.url,
    title: page.data.title,
    description: page.data.description ?? '',
    markdownUrl: pageMarkdownUrl(page),
    imageUrl: pageImageUrl(page),
    lastModified: lastModified?.toISOString() ?? null,
    pageTree: await source.serializePageTree(source.getPageTree(locale)),
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const image = `${siteOrigin}${loaderData.imageUrl}`
  return [
    { title: `${loaderData.title} · Fingerprint Detector` },
    { name: 'description', content: loaderData.description },
    { property: 'og:title', content: loaderData.title },
    { property: 'og:description', content: loaderData.description },
    { property: 'og:url', content: `${siteOrigin}${loaderData.url}` },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:image', content: image },
  ]
}

type OpenAPIData = Awaited<ReturnType<typeof openapi.preloadOpenAPIPage>> | null

function Content({ path, markdownUrl, lastModified, openapiData }: { path: string; markdownUrl: string; lastModified: string | null; openapiData: OpenAPIData }) {
  const page = docs.getPage(path)
  if (!page) throw new Error(`Unknown page: ${path}`)
  const { toc } = use(page.load())
  const Body = page.body
  return (
    <DocsPage toc={toc} full={page.full} tableOfContent={{ style: 'clerk' }} className="sm:px-6 md:px-8 md:pt-6 xl:pt-6">
      <h1 className="text-h1">{page.title}</h1>
      {page.description && <p className="text-body text-fd-muted-foreground">{page.description}</p>}
      <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={`${repositoryUrl}/blob/${repository.branch}/${repository.contentDir}/${path}`} />
      </div>
      <DocsBody>
        <Body components={useMDXComponents(openapiData
          ? { OpenAPIPage: (props: ComponentProps<typeof OpenAPIPage>) => <OpenAPIPage {...openapiData} {...props} /> }
          : undefined)} />
      </DocsBody>
      {lastModified && <PageLastUpdate date={new Date(lastModified)} />}
    </DocsPage>
  )
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { locale, path, markdownUrl, lastModified, pageTree, openapiData } = useFumadocsLoader(loaderData)
  return (
    <>
      <SiteHeader locale={locale} />
      <DocsLayout {...layoutOptions} tree={pageTree} slots={{ header: DocsBar }} sidebar={{ collapsible: false }}>
        <Content path={path} markdownUrl={markdownUrl} lastModified={lastModified} openapiData={openapiData} />
      </DocsLayout>
    </>
  )
}

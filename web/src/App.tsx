import { useEffect, useRef, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  Fingerprint,
  ScanLine,
  Database,
  ArrowUpRight,
  ArrowRight,
  Copy,
  RefreshCw,
  Download,
  Check,
  Search,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "./components/ui/empty";
import { Skeleton } from "./components/ui/skeleton";
import { Separator } from "./components/ui/separator";
import { Progress } from "./components/ui/progress";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./components/ui/sheet";
import { Switch } from "./components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { Toaster } from "./components/ui/sonner";
import * as client from "./lib/client";
import type {
  Bank,
  Analysis,
  ApiConfig,
  CollectionProgress,
  SampleRow,
} from "@fingerpoint/shared/types";

const sourceNames: Record<string, string> = { original: "原始数据", openrouter: "OpenRouter", api: "API", codex: "Codex" };
const num = (n: number) => n.toLocaleString("zh-CN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const problem = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试。";
const defaultConfig: ApiConfig = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "",
  effort: "",
  format: "openai",
  stream: true,
  parallel: false,
};
function useApiConfig(storageKey: string) {
  const [config, setConfig] = useState<ApiConfig>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      const restored = { ...defaultConfig };
      if (!saved || typeof saved !== "object") return restored;
      for (const field of ["baseUrl", "apiKey", "model", "effort"] as const) {
        if (typeof saved[field] === "string") restored[field] = saved[field];
      }
      if (["openai", "responses", "anthropic"].includes(saved.format)) restored.format = saved.format;
      for (const field of ["stream", "parallel"] as const) {
        if (typeof saved[field] === "boolean") restored[field] = saved[field];
      }
      return restored;
    } catch { return { ...defaultConfig }; }
  });
  const warned = useRef(false);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(config)); }
    catch {
      if (!warned.current) toast.error("浏览器未允许保存配置，刷新后需要重新填写。");
      warned.current = true;
    }
  }, [config, storageKey]);
  return [config, setConfig] as const;
}
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <Alert variant="destructive">
      <AlertTitle>暂时无法完成</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;
}
function Page({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="fp-page"
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
function Header({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="fp-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="fp-lead">{description}</p>}
      </div>
      {action}
    </header>
  );
}
function Busy({ progress, showOutputs = true }: { progress: CollectionProgress | null; showOutputs?:boolean }) {
  return (
    progress && (
      <div className="fp-progress" role="status">
        <div className="fp-between">
          <span>{progress.message}</span>
          <span className="fp-mono">
            {progress.completed} / {progress.total}
          </span>
        </div>
        <Progress
          aria-label="采集进度"
          value={
            progress.total ? (progress.completed / progress.total) * 100 : 0
          }
        />
        <p className="fp-muted">已接受 {progress.accepted} 条有效回答</p>
        {showOutputs && progress.challenges?.map((c,i)=><section key={i} aria-label={`挑战 ${i+1} 输出`}><p>挑战 {i+1} · {c.status}</p>{c.text && <pre className="fp-stream-output">{c.text}</pre>}</section>)}
        {showOutputs && progress.text && <pre className="fp-stream-output" aria-label="实时输出">{progress.text}</pre>}
      </div>
    )
  );
}
function ApiFields({
  config,
  onChange,
  disabled,
}: {
  config: ApiConfig;
  onChange: (v: ApiConfig) => void;
  disabled: boolean;
}) {
  const update = (k: keyof ApiConfig, v: string) =>
    onChange({ ...config, [k]: v });
  return (
    <FieldGroup className="fp-api-fields">
      <Field>
        <FieldLabel htmlFor="test-url">
          API 地址
        </FieldLabel>
        <Input
          id="test-url"
          value={config.baseUrl}
          disabled={disabled}
          onChange={(e) => update("baseUrl", e.target.value)}
          placeholder="https://openrouter.ai/api/v1"
        />
        <FieldDescription>
          请求通过本站代理转发到此地址。这只是为了绕过浏览器 CORS 限制，我们绝不会记录你的 APIKEY。
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="test-key">
          API 密钥
        </FieldLabel>
        <Input
          id="test-key"
          type="password"
          autoComplete="off"
          value={config.apiKey}
          disabled={disabled}
          onChange={(e) => update("apiKey", e.target.value)}
          placeholder="保存在当前浏览器，刷新后自动恢复"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="test-model">
          接口模型 ID
        </FieldLabel>
        <Input
          id="test-model"
          value={config.model}
          disabled={disabled}
          onChange={(e) => update("model", e.target.value)}
          placeholder="例如 openai/gpt-4.1"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="test-effort">
          推理强度（可选）
        </FieldLabel>
        <Input
          id="test-effort"
          value={config.effort}
          disabled={disabled}
          onChange={(e) => update("effort", e.target.value)}
          placeholder="留空使用服务默认值"
        />
      </Field>
      {(
        <Field>
          <FieldLabel>API 端点类型</FieldLabel>
          <ToggleGroup
            value={[config.format]}
            onValueChange={(v) => v[0] && update("format", String(v[0]))}
            disabled={disabled}
            variant="outline"
            className="max-w-full flex-wrap"
            aria-label="API 端点类型"
          >
            <ToggleGroupItem value="openai">Chat Completions</ToggleGroupItem>
            <ToggleGroupItem value="responses">Responses</ToggleGroupItem>
            <ToggleGroupItem value="anthropic">Messages</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      )}
      <Field>
        <FieldLabel>调用模式</FieldLabel>
        <ToggleGroup aria-label="调用模式" value={[config.stream === false ? "buffered" : "stream"]} onValueChange={(v)=>v[0] && onChange({...config,stream:v[0]==="stream"})} disabled={disabled} variant="outline">
          <ToggleGroupItem value="stream">流式输出</ToggleGroupItem>
          <ToggleGroupItem value="buffered">完整响应</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field data-disabled={disabled}>
        <FieldLabel htmlFor="test-parallel">并行挑战</FieldLabel>
        <Switch id="test-parallel" checked={config.parallel ?? false} onCheckedChange={(checked)=>onChange({...config,parallel:checked})} disabled={disabled} />
        <FieldDescription>打开后三个挑战同时发送；关闭时依次发送。</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
function Results({ result }: { result: Analysis | null }) {
  if (!result)
    return (
      <section className="fp-result-empty">
        <Empty className="flex-row justify-start px-0 py-4 text-left">
          <EmptyHeader className="max-w-none items-start gap-1">
            <EmptyTitle>检测结果将在这里显示</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </section>
    );
  return (
    <section className="fp-results">
      <div className="fp-between">
        <h2>检测结果</h2>
        <Button variant="outline" onClick={() => client.exportAnalysis(result)}>
          <Download data-icon="inline-start" />
          导出结果
        </Button>
      </div>
      <div className="fp-winner">
        <div>
          <p className="fp-eyebrow">{result.decision === 'unscorable' ? '回答尚未齐全' : '排名第一的库内候选'}</p>
          <h3>{result.prediction_name}</h3>
          <p className="fp-muted">
            {result.family_prediction_name && `${result.family_prediction_name} · `}有效回答 {result.used_outputs}/3
          </p>
        </div>
        <div className="fp-scores">
        <div className="fp-score">
          <strong>{result.results[0]?.score.toFixed(3) ?? '—'}</strong>
          <span>排名分数</span>
        </div>
        <div className="fp-score">
          <strong>{result.results[0]?.verification_confidence != null ? pct(result.results[0].verification_confidence) : '—'}</strong>
          <span>置信度</span>
        </div>
        </div>
      </div>
      <p className="fp-muted">
        排名分数决定候选顺序；置信度是当前核验器对各候选的匹配估计，各项不要求合计 100%。
      </p>
      {(result.verification_confidence == null || result.verification_top !== result.prediction) && <Alert variant={result.decision === 'unscorable' ? "destructive" : "default"}>
        <AlertTitle>{result.evidence.label}</AlertTitle>
        <AlertDescription>
          <p>{result.evidence.reason}</p>
        </AlertDescription>
      </Alert>}
      <div className="fp-diagnostics">
        {result.diagnostics.map((d) => (
          <div key={d.index}>
            <Badge variant={d.accepted ? "secondary" : "destructive"}>
              {d.accepted ? "已采用" : "未采用"}
            </Badge>
            <span>回答 {d.index + 1}</span>
            <span className="fp-mono">{d.parsed_numbers} 个数字</span>
            <span className="fp-muted">最低 {d.minimum_numbers} 个</span>
          </div>
        ))}
      </div>
      <div className="fp-table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>所有候选</TableHead>
              <TableHead>模型家族</TableHead>
              <TableHead>排名分数</TableHead>
              <TableHead>置信度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.results.map((r, i) => (
              <TableRow key={r.model}>
                <TableCell>
                  <span className="fp-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {r.display_name}
                </TableCell>
                <TableCell>{r.family_name}</TableCell>
                <TableCell className="fp-mono">{r.score.toFixed(3)}</TableCell>
                <TableCell className="fp-mono">{r.verification_confidence != null ? pct(r.verification_confidence) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
function Detect({ bank }: { bank: Bank }) {
  const [challenges, setChallenges] = useState(() =>
    client.generateChallenges(3),
  );
  const [answers, setAnswers] = useState(["", "", ""]);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useApiConfig("fingerpoint-detect-api-v1");
  const [progress, setProgress] = useState<CollectionProgress | null>(null);
  const [apiRunConfig, setApiRunConfig] = useState<ApiConfig | null>(null);
  const [apiAnswers, setApiAnswers] = useState<{text:string;status:string}[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const reduced = useReducedMotion();
  useEffect(() => () => controller.current?.abort(), []);
  const ready = answers.filter((x) => x.trim().length > 0).length;
  async function run(api = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress(null);
    try {
      let outputs = challenges.map((c, i) => ({
        text: answers[i],
        expected_count: c.expected_count,
      }));
      if (api) {
        controller.current = new AbortController();
        setApiRunConfig({...config});
        setApiAnswers(challenges.map(()=>({text:'',status:'等待发送'})));
        setAnswers(challenges.map(()=>''));
        outputs = await client.testApi(
          config,
          challenges,
          p => {
            setProgress(p);
            if (p.challenges) setApiAnswers(p.challenges);
            if (p.outputs) setAnswers(p.outputs.map(o=>o.text));
          },
          controller.current.signal,
        );
        setAnswers(outputs.map((o) => o.text));
      }
      setResult(await client.analyze(outputs, bank));
    } catch (e) {
      setError(problem(e));
      setProgress((p) => p ? { ...p, message: "请求已停止", challenges: p.challenges?.map(c=>({...c,status:["正在请求","正在接收输出"].includes(c.status)?"已停止":c.status})) } : null);
      if (api) setApiAnswers(current=>current.map(c=>({...c,status:["正在请求","正在接收输出","等待发送"].includes(c.status)?"已停止":c.status})));
    } finally {
      controller.current = null;
      running.current = false;
      setBusy(false);
    }
  }
  async function retryAnswer(index:number) {
    if (running.current || !apiRunConfig || !challenges[index]) return;
    running.current = true;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true);
    setRetrying(index);
    setError('');
    setProgress(null);
    setApiAnswers(current=>current.map((c,i)=>i===index?{text:'',status:'正在请求'}:c));
    let replaced=false;
    try {
      const [replacement] = await client.testApi(
        {...apiRunConfig,parallel:false},
        [challenges[index]],
        p => {
          setProgress({...p,message:`重试回答 ${index+1}：${p.challenges?.[0]?.status || p.message}`,challengeIndex:index});
          const state=p.challenges?.[0];
          if (state) setApiAnswers(current=>current.map((c,i)=>i===index?state:c));
        },
        requestController.signal,
      );
      requestController.signal.throwIfAborted();
      const next=answers.map((text,i)=>i===index?replacement.text:text);
      setAnswers(next);
      replaced=true;
      setResult(null);
      setResult(await client.analyze(next.map((text,i)=>({text,expected_count:challenges[i].expected_count})),bank));
    } catch (e) {
      const cancelled=requestController.signal.aborted;
      if (replaced) {
        setError(`回答 ${index+1} 已更新，但重新检测失败：${problem(e)}`);
        return;
      }
      setError(cancelled?`已取消回答 ${index+1} 的重试，原回答已保留。`:problem(e));
      setApiAnswers(current=>current.map((c,i)=>i===index?{text:answers[index] || c.text,
        status:cancelled?'重试已取消，原回答保留':answers[index]?'重试失败，原回答保留':'重试失败，尚无有效回答'}:c));
      setProgress(p=>p?{...p,message:`回答 ${index+1} ${cancelled?'重试已取消':'重试未完成'}`} : null);
    } finally {
      controller.current = null;
      running.current = false;
      setRetrying(null);
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(challenges[active].prompt);
      toast.success("提示词已复制");
    } catch {
      toast.error("无法自动复制，请选中提示词手动复制。");
    }
  }
  return (
    <Page>
      <Header
        title="模型检测"
      />
      <Tabs defaultValue="manual">
        <div className="fp-between fp-mode-row">
          <TabsList variant="line">
            <TabsTrigger value="manual">手动检测</TabsTrigger>
            <TabsTrigger value="api">API 检测</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="manual">
          <div className="fp-between fp-steps-row">
            <ToggleGroup
              aria-label="选择挑战"
              className="max-w-full flex-wrap"
              value={[String(active)]}
              onValueChange={(v) =>
                v[0] !== undefined && setActive(Number(v[0]))
              }
              variant="outline"
              disabled={busy}
            >
              {challenges.map((c, i) => (
                <ToggleGroupItem key={c.id} value={String(i)}>
                  <span className="fp-mono">0{i + 1}</span> 挑战 {i + 1}
                  {answers[i].trim() && <Check />}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <span className="fp-muted">{ready} / 3 已填写</span>
          </div>
          <motion.div
            className="fp-editor"
            layout
            transition={{
              type: "spring",
              stiffness: 360,
              damping: 32,
              mass: 0.8,
            }}
          >
            <section className="fp-prompt">
              <div className="fp-between">
                <h2>复制提示词</h2>
                <Button variant="ghost" onClick={copy}>
                  <Copy data-icon="inline-start" />
                  复制
                </Button>
              </div>
              <p className="fp-muted">
                在待检测模型的新对话中发送，每条挑战单独开启对话。
              </p>
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, x: reduced ? 0 : 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                >
                  <p className="fp-prompt-text">{challenges[active].prompt}</p>
                </motion.div>
              </AnimatePresence>
            </section>
            <section className="fp-answer">
              <FieldGroup>
                <Field>
                  <div className="fp-between">
                    <FieldLabel htmlFor="answer">粘贴模型回答</FieldLabel>
                    <span className="fp-mono fp-muted">
                      {client.parseNumbers(answers[active]).length} 个数字
                    </span>
                  </div>
                  <Textarea
                    id="answer"
                    className="fp-answer-input"
                    value={answers[active]}
                    disabled={busy}
                    onChange={(e) => {
                      const next = [...answers];
                      next[active] = e.target.value;
                      setAnswers(next);
                      if (apiRunConfig) setApiAnswers(current=>current.map((c,i)=>i===active?{text:next[active],status:'手动修改'}:c));
                      setResult(null);
                    }}
                    placeholder="将这一条挑战的完整回答粘贴到这里…"
                  />
                  <FieldDescription>
                    切换挑战会保留已填写内容。正式库需要三条完整回答才能评分。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </section>
          </motion.div>
          <div className="fp-action-row">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setChallenges(client.generateChallenges(3));
                setAnswers(["", "", ""]);
                setActive(0);
                setResult(null);
                setError("");
                setProgress(null);
                setApiRunConfig(null);
                setApiAnswers([]);
                toast("已生成三条新挑战");
              }}
            >
              <RefreshCw data-icon="inline-start" />
              重新生成挑战
            </Button>
            <Button
              size="lg"
              disabled={busy || ready === 0}
              onClick={() => run()}
            >
              {busy ? (
                <Loader2 data-icon="inline-start" />
              ) : (
                <ScanLine data-icon="inline-start" />
              )}
              {busy ? "正在比较…" : "开始检测"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="api">
          <section className="fp-api-section">
            <div className="fp-section-intro">
              <h2>直接连接待检测模型</h2>
              <p className="fp-muted">
                通过本站代理发送三条挑战，实时查看回答，再与统一库比较。
              </p>
            </div>
            <ApiFields config={config} onChange={setConfig} disabled={busy} />
            <div className="fp-action-row">
              <span className="fp-muted">配置（含 API 密钥）自动保存在当前浏览器</span>
              <Button
                size="lg"
                disabled={
                  busy || !config.apiKey || !config.model || !config.baseUrl
                }
                onClick={() => run(true)}
              >
                {busy ? "正在检测…" : "发送挑战并检测"}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
            {apiRunConfig && (
              <div className="flex flex-col gap-6" aria-label="本轮 API 回答">
                <p className="fp-muted">本轮模型：{apiRunConfig.model}。单条重试沿用本轮配置和原提示词，只替换成功返回的这一条回答。</p>
                {challenges.map((challenge,i)=>(
                  <section key={challenge.id} aria-label={`回答 ${i+1}`}>
                    <div className="fp-between">
                      <div>
                        <h3>回答 {i+1}</h3>
                        <p className="fp-muted">{apiAnswers[i]?.status || '等待发送'}</p>
                      </div>
                      <Button variant="outline" disabled={busy} aria-label={`重试回答 ${i+1}`} onClick={()=>retryAnswer(i)}>
                        {retrying===i?<Loader2 data-icon="inline-start"/>:<RefreshCw data-icon="inline-start"/>}
                        {retrying===i?'正在重试…':'单独重试'}
                      </Button>
                    </div>
                    {apiAnswers[i]?.text && <pre className="fp-stream-output">{apiAnswers[i].text}</pre>}
                  </section>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
      <Busy progress={progress} showOutputs={!apiRunConfig} />
      {busy && controller.current && (
        <Button variant="outline" onClick={() => controller.current?.abort()}>
          取消请求
        </Button>
      )}
      <ErrorMessage message={error} />
      <Results result={result} />
    </Page>
  );
}
function Library({ bank }: { bank: Bank }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleRow[] | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(12);
  const models = bank.models.filter((m) =>
    `${m.display_name} ${m.id} ${m.family_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setSamples(null);
    setError("");
    setLimit(12);
    client
      .loadSamples(selected)
      .then((rows) => live && setSamples(rows))
      .catch((e) => live && setError(problem(e)));
    return () => {
      live = false;
    };
  }, [selected]);
  const selectedModel = bank.models.find((m) => m.id === selected);
  return (
    <Page>
      <Header
        title="统一库"
        action={
          <Button
            variant="outline"
            onClick={() =>
              client.exportReferences().catch((e) => toast.error(problem(e)))
            }
          >
            <Download data-icon="inline-start" />
            导出全部样本
          </Button>
        }
      />
      <div className="fp-stats">
        <div>
          <span>候选模型</span>
          <strong>{num(bank.models.length)}</strong>
        </div>
        <div>
          <span>回答样本</span>
          <strong>
            {num(bank.models.reduce((s, m) => s + m.response_count, 0))}
          </strong>
        </div>
        <div>
          <span>来源类别</span>
          <strong>{num(Object.keys(bank.sources).length)}</strong>
        </div>
        <div className="fp-stat-note">
          <ShieldCheck />
          <p>
            原始数据与 OpenRouter
            <br />
            <span className="fp-muted">统一索引，可追溯来源</span>
          </p>
        </div>
      </div>
      <div className="fp-between fp-library-toolbar">
        <FieldGroup className="fp-search">
          <Field>
            <FieldLabel htmlFor="search" className="sr-only">
              搜索模型
            </FieldLabel>
            <Input
              id="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型名称、ID 或家族…"
            />
          </Field>
        </FieldGroup>
        <Button variant="ghost" onClick={() => client.exportBank(bank)}>
          <Download data-icon="inline-start" />
          导出指纹库
        </Button>
      </div>
      <div className="fp-table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型</TableHead>
              <TableHead>家族</TableHead>
              <TableHead>样本</TableHead>
              <TableHead>有效数字</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>
                <span className="sr-only">详情</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="fp-model-name">{m.display_name}</div>
                  {m.display_name !== m.id && (
                    <div className="fp-mono fp-muted fp-small">{m.id}</div>
                  )}
                </TableCell>
                <TableCell>{m.family_name}</TableCell>
                <TableCell className="fp-mono">
                  {num(m.response_count)}
                </TableCell>
                <TableCell className="fp-mono">
                  {num(m.valid_number_count)}
                </TableCell>
                <TableCell>
                  {Object.keys(m.sources)
                    .map((s) =>
                      s === "original"
                        ? "原始数据"
                        : s === "openrouter"
                          ? "OpenRouter"
                          : s,
                    )
                    .join(" / ")}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`查看 ${m.display_name} 来源与样本`}
                    onClick={() => setSelected(m.id)}
                  >
                    <ArrowUpRight />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!models.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Search />
            </EmptyMedia>
            <EmptyTitle>没有找到匹配模型</EmptyTitle>
            <EmptyDescription>
              尝试使用更短的名称或模型家族搜索。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="fp-library-foot">
        显示 {models.length} / {bank.models.length} 个模型{" "}
        <span>
          库构建时间：{new Date(bank.built_at).toLocaleString("zh-CN")}
        </span>
      </p>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="fp-sample-sheet">
          <SheetHeader>
            <SheetTitle>{selectedModel?.display_name} · 来源与样本</SheetTitle>
            <SheetDescription>
              source 是模型标签；provenance.kind 是来源类别。
            </SheetDescription>
          </SheetHeader>
          <div className="fp-sheet-body">
            <ErrorMessage message={error} />
            {!samples && !error ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              samples && (
                <>
                  <div className="fp-source-summary">
                    <h2>{num(samples.length)} 条原始回答</h2>
                    {Object.entries(
                      samples.reduce<Record<string, number>>((s, r) => {
                        s[r.provenance.kind] = (s[r.provenance.kind] || 0) + 1;
                        return s;
                      }, {}),
                    ).map(([kind, count]) => (
                      <p key={kind}>
                        {sourceNames[kind] ?? kind}{" "}
                        <span className="fp-mono">{num(count)}</span>
                      </p>
                    ))}
                  </div>
                  <Separator />
                  {samples.slice(0, limit).map((row, i) => (
                    <article className="fp-sample" key={row.row_id || i}>
                      <div className="fp-between">
                        <span className="fp-mono">
                          SAMPLE {String(i + 1).padStart(3, "0")}
                        </span>
                        <Badge
                          variant={row.strict_valid ? "secondary" : "outline"}
                        >
                          {row.strict_valid ? "达到采集阈值" : "未达到采集阈值"}
                        </Badge>
                      </div>
                      <dl>
                        <dt>source</dt>
                        <dd>{row.source}</dd>
                        <dt>provenance.kind</dt>
                        <dd>{row.provenance.kind}</dd>
                        {row.provenance.endpoint && (
                          <>
                            <dt>endpoint</dt>
                            <dd>{row.provenance.endpoint}</dd>
                          </>
                        )}
                        <dt>challenge</dt>
                        <dd>{row.challenge_id}</dd>
                        <dt>实际 / 要求数字</dt>
                        <dd className="fp-mono">
                          {client.parseNumbers(row.text).length} /{" "}
                          {row.requested_count}
                        </dd>
                        <dt>采集时间</dt>
                        <dd>
                          {row.collected_at
                            ? new Date(row.collected_at).toLocaleString("zh-CN")
                            : "原记录未提供"}
                        </dd>
                        <dt>批次</dt>
                        <dd>
                          {String(
                            row.provenance.batch ?? row.batch ?? "原记录未提供",
                          )}
                        </dd>
                        {row.provenance.provider != null && (<>
                          <dt>声明提供方</dt><dd>{String(row.provenance.provider)}</dd>
                          <dt>采集渠道</dt><dd>{String(row.provenance.name ?? row.provenance.kind)}</dd>
                        </>)}
                        {row.provenance.kind === "original" && (
                          <>
                            <dt>original_provider</dt>
                            <dd>
                              {String(
                                row.provenance.original_provider ??
                                  row.original_provider ??
                                  "原记录未提供",
                              )}
                            </dd>
                          </>
                        )}
                        {row.provenance.kind === "openrouter" && (
                          <>
                            <dt>网关归属</dt>
                            <dd>{String(row.provenance.name ?? "OpenRouter（按采集记录）")}</dd>
                          </>
                        )}
                      </dl>
                      <details className="fp-prompt-detail">
                        <summary>查看原始提示词</summary>
                        {row.prompt ? (
                          <pre>{row.prompt}</pre>
                        ) : (
                          <p className="fp-muted">原记录未提供提示词。</p>
                        )}
                      </details>
                      <pre>{row.text}</pre>
                    </article>
                  ))}
                  {samples.length > limit && (
                    <Button
                      variant="outline"
                      onClick={() => setLimit((n) => n + 12)}
                    >
                      再显示 12 条
                    </Button>
                  )}
                </>
              )
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
function Workspace() {
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState("");
  const location = useLocation();
  const reduced = useReducedMotion();
  async function reload() {
    setError("");
    try {
      setBank(await client.loadBank());
    } catch (e) {
      setError(problem(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  const links = [
    { to: "/", label: "检测", icon: ScanLine, no: "01" },
    { to: "/library", label: "统一库", icon: Database, no: "02" },
  ];
  return (
    <div className="fp-app">
      <header className="fp-navigation">
        <div className="fp-navigation-inner">
        <NavLink to="/" className="fp-brand">
          <Fingerprint strokeWidth={1.6} />
          <div>
            <strong>Fingerpoint</strong>

          </div>
        </NavLink>

        <nav aria-label="主导航">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink to={to} end={to === "/"} key={to} className="fp-nav-link">
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      className="fp-nav-active"
                      layoutId="active-nav"
                      transition={
                        reduced
                          ? { duration: 0 }
                          : {
                              type: "spring",
                              stiffness: 360,
                              damping: 32,
                              mass: 0.8,
                            }
                      }
                    />
                  )}
                  <Icon />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="fp-bank-status" aria-live="polite">
          <div className="fp-online">
            <span />
            {bank
              ? "统一库已连接"
              : error
                ? "统一库连接失败"
                : "正在连接统一库"}
          </div>
          <p>
            {bank
              ? `${num(bank.models.length)} 个模型 · ${num(bank.models.reduce((s, m) => s + m.response_count, 0))} 条样本`
              : "正在读取统一库…"}
          </p>
        </div>
        </div>
      </header>
      <main className="fp-main">
        {error ? (
          <Page>
            <Header
              title="统一库加载失败"
              description="请检查网络连接后重新加载。"
            />
            <ErrorMessage message={error} />
            <Button onClick={reload}>重试加载</Button>
          </Page>
        ) : !bank ? (
          <Page>
            <h1 className="sr-only">正在加载统一库</h1>
            <Skeleton className="h-10 w-80 max-w-full" />
            <Skeleton className="h-5 w-96 max-w-full" />
            <Skeleton className="h-96 w-full" />
          </Page>
        ) : (
          <div key={location.pathname}>
            <Routes>
              <Route path="/" element={<Detect bank={bank} />} />
              <Route path="/library" element={<Library bank={bank} />} />
              <Route
                path="*"
                element={
                  <Page>
                    <Header
                      title="这个页面不存在"
                      description="请从顶部导航返回工作台。"
                    />
                  </Page>
                }
              />
            </Routes>
          </div>
        )}
      </main>
      <Toaster theme="light" position="bottom-right" />
    </div>
  );
}
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <Workspace />
      </HashRouter>
    </MotionConfig>
  );
}

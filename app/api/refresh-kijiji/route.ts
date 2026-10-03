import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export const maxDuration = 300

type Mode = "prune" | "scrape"

interface ProgressEvent {
  step: string
  progress: number
  [key: string]: unknown
}

interface DoneEvent {
  done: true
  ok: boolean
  message: string
  pruned?: number | null
  scraped?: number | null
  bathrooms?: number | null
}

async function runCmd(cmd: string): Promise<string> {
  const { stdout, stderr } = await execAsync(cmd, {
    cwd: process.cwd(),
    timeout: 290_000,
  })
  return stdout + (stderr ? `\nSTDERR: ${stderr}` : "")
}

function parseCount(output: string, pattern: RegExp): number | null {
  const m = output.match(pattern)
  return m ? parseInt(m[1], 10) : null
}

function parsePruned(output: string): number | null {
  return (
    parseCount(output, /Deactivated\s+(\d+)/) ??
    parseCount(output, /Removed\s+(\d+)/) ??
    parseCount(output, /(\d+)\s+removed/)
  )
}

function doneResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ done: true, ok: false, message }) + "\n", {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  })
}

type Counts = { pruned: number | null; scraped: number | null; bathrooms: number | null }

interface Step {
  label: string
  cmd: string
  /** Progress reached when this step finishes, per mode */
  end: Record<Mode, number>
  record?: (output: string, counts: Counts) => void
  scrapeOnly?: boolean
}

const STEPS: Step[] = [
  {
    label: "Scraping new listings…",
    cmd: "python -m padestrian scrape-listings --pages 5 --append",
    end: { scrape: 45, prune: 0 },
    scrapeOnly: true,
    record: (out, c) => {
      c.scraped = parseCount(out, /Scraped \+ normalized new listings:\s*(\d+)/)
    },
  },
  {
    label: "Pruning dead listings…",
    cmd: "python -m padestrian prune-kijiji",
    end: { scrape: 65, prune: 35 },
    record: (out, c) => {
      c.pruned = parsePruned(out)
    },
  },
  {
    label: "Filling bathroom data…",
    cmd: "python -m padestrian backfill-bathrooms --fetch",
    end: { scrape: 80, prune: 60 },
    record: (out, c) => {
      c.bathrooms = parseCount(out, /Updated\s+(\d+)/)
    },
  },
  {
    label: "Validating listings…",
    cmd: "python -m padestrian validate-listings",
    end: { scrape: 90, prune: 80 },
  },
  {
    label: "Scoring listings…",
    cmd: "python -m padestrian filter-listings",
    end: { scrape: 100, prune: 100 },
  },
]

export async function POST(request: Request) {
  // Shells out to the Python pipeline — never expose this on a deployed server
  if (process.env.NODE_ENV === "production") {
    return doneResponse("Refresh is only available when running locally", 403)
  }

  let mode: Mode = "prune"
  try {
    const body = await request.json()
    if (body?.mode === "scrape") mode = "scrape"
  } catch {
    // default to prune
  }

  // Verify Python is available
  try {
    await execAsync("python --version", { timeout: 5_000 })
  } catch {
    return doneResponse("Python not found — run locally", 501)
  }

  const steps = STEPS.filter((step) => mode === "scrape" || !step.scrapeOnly)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent | DoneEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      }

      const counts: Counts = { pruned: null, scraped: null, bathrooms: null }

      try {
        let progress = 0
        for (const step of steps) {
          send({ step: step.label, progress })
          const out = await runCmd(step.cmd)
          step.record?.(out, counts)
          progress = step.end[mode]
          send({ step: step.label, progress, ...counts })
        }

        const parts: string[] = []
        if (mode === "scrape") parts.push(`${counts.scraped ?? 0} new`)
        parts.push(`${counts.pruned ?? 0} pruned`)
        if (counts.bathrooms != null && counts.bathrooms > 0) {
          parts.push(`${counts.bathrooms} baths filled`)
        }

        send({ done: true, ok: true, message: parts.join(", "), ...counts })
      } catch (err) {
        send({
          done: true,
          ok: false,
          message: err instanceof Error ? err.message.slice(0, 500) : String(err),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  })
}

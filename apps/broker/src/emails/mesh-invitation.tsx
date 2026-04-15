import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface MeshInvitationProps {
  meshName: string;
  inviteUrl: string;
  token: string;
  expiresAt: string;
  appBaseUrl: string;
}

// Brand tokens — mirror of apps/web/src/assets/styles/globals.css (--cm-*).
// Inlined here because email clients don't resolve CSS vars.
const brand = {
  bg: "#141413",
  bgElevated: "#1f1e1d",
  bgCode: "#0f0e0d",
  fg: "#faf9f5",
  fgSecondary: "#c2c0b6",
  fgTertiary: "#87867f",
  clay: "#d97757",
  clayBorder: "rgba(217, 119, 87, 0.35)",
  border: "rgba(217, 119, 87, 0.2)",
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  sans:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
} as const;

export const MeshInvitation = ({
  meshName,
  inviteUrl,
  token,
  expiresAt,
  appBaseUrl,
}: MeshInvitationProps) => {
  const expiresLabel = new Date(expiresAt).toUTCString();
  const launchCmd = `claudemesh launch --join ${inviteUrl}`;
  const oneLiner = `npm i -g claudemesh-cli && ${launchCmd}`;

  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
      </Head>
      <Preview>You've been invited to the {meshName} mesh on claudemesh</Preview>
      <Body
        style={{
          backgroundColor: brand.bg,
          color: brand.fg,
          fontFamily: brand.sans,
          margin: 0,
          padding: "40px 0",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "0 24px",
          }}
        >
          {/* Header — mesh glyph + wordmark */}
          <Section style={{ marginBottom: "40px" }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
              <tr>
                <td style={{ verticalAlign: "middle", paddingRight: "10px" }}>
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="12" cy="4" r="2" fill={brand.clay} />
                    <circle cx="4" cy="12" r="2" fill={brand.clay} />
                    <circle cx="20" cy="12" r="2" fill={brand.clay} />
                    <circle cx="12" cy="20" r="2" fill={brand.clay} />
                    <path
                      d="M12 4L4 12M12 4L20 12M4 12L12 20M20 12L12 20M4 12L20 12M12 4L12 20"
                      stroke={brand.clay}
                      strokeWidth="1.2"
                      opacity="0.45"
                      fill="none"
                    />
                  </svg>
                </td>
                <td style={{ verticalAlign: "middle" }}>
                  <Text
                    style={{
                      fontFamily: brand.serif,
                      fontSize: "17px",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                      color: brand.fg,
                      margin: 0,
                    }}
                  >
                    claudemesh
                  </Text>
                </td>
              </tr>
            </table>
          </Section>

          {/* Eyebrow */}
          <Text
            style={{
              fontFamily: brand.mono,
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.22em",
              color: brand.clay,
              margin: "0 0 16px 0",
            }}
          >
            — you're invited
          </Text>

          {/* Heading */}
          <Heading
            as="h1"
            style={{
              fontFamily: brand.serif,
              fontSize: "32px",
              fontWeight: 500,
              lineHeight: "1.15",
              letterSpacing: "-0.01em",
              color: brand.fg,
              margin: "0 0 20px 0",
            }}
          >
            Join{" "}
            <span style={{ fontFamily: brand.mono, color: brand.clay }}>
              {meshName}
            </span>{" "}
            on claudemesh
          </Heading>

          {/* Body prose */}
          <Text
            style={{
              fontFamily: brand.serif,
              fontSize: "16px",
              lineHeight: "1.65",
              color: brand.fgSecondary,
              margin: "0 0 32px 0",
            }}
          >
            claudemesh is a peer mesh for Claude Code sessions — end-to-end
            encrypted, keys stay on your machine. Open the link below to see
            the mesh, the inviter, and the command to join.
          </Text>

          {/* Primary CTA */}
          <Section style={{ marginBottom: "36px" }}>
            <Button
              href={inviteUrl}
              style={{
                backgroundColor: brand.clay,
                color: brand.fg,
                fontFamily: brand.sans,
                fontSize: "15px",
                fontWeight: 500,
                textDecoration: "none",
                padding: "14px 28px",
                borderRadius: "4px",
                display: "inline-block",
              }}
            >
              Open invite →
            </Button>
          </Section>

          {/* Terminal shortcut — for the already-set-up crowd */}
          <Text
            style={{
              fontFamily: brand.mono,
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.22em",
              color: brand.fgTertiary,
              margin: "0 0 12px 0",
            }}
          >
            — already have the CLI?
          </Text>
          <Section
            style={{
              backgroundColor: brand.bgElevated,
              border: `1px solid ${brand.clayBorder}`,
              borderRadius: "6px",
              padding: "16px 18px",
              marginBottom: "32px",
            }}
          >
            <Text
              style={{
                fontFamily: brand.mono,
                fontSize: "12px",
                color: brand.fg,
                margin: 0,
                wordBreak: "break-all",
                lineHeight: "1.6",
              }}
            >
              {launchCmd}
            </Text>
          </Section>

          {/* First-time one-liner */}
          <Text
            style={{
              fontFamily: brand.mono,
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.22em",
              color: brand.fgTertiary,
              margin: "0 0 12px 0",
            }}
          >
            — first time? one command
          </Text>
          <Section
            style={{
              backgroundColor: brand.bgElevated,
              border: `1px solid ${brand.border}`,
              borderRadius: "6px",
              padding: "16px 18px",
              marginBottom: "32px",
            }}
          >
            <Text
              style={{
                fontFamily: brand.mono,
                fontSize: "12px",
                color: brand.fg,
                margin: 0,
                lineHeight: "1.6",
                wordBreak: "break-all",
              }}
            >
              {oneLiner}
            </Text>
            <Text
              style={{
                fontFamily: brand.serif,
                fontSize: "12px",
                color: brand.fgTertiary,
                margin: "8px 0 0 0",
              }}
            >
              Requires Node.js 20+. Display name defaults to $USER.
            </Text>
          </Section>

          <Hr
            style={{
              border: "none",
              borderTop: `1px solid ${brand.border}`,
              margin: "28px 0 20px 0",
            }}
          />

          {/* Footer meta */}
          <Text
            style={{
              fontFamily: brand.serif,
              fontSize: "13px",
              lineHeight: "1.6",
              color: brand.fgTertiary,
              margin: "0 0 8px 0",
            }}
          >
            Expires{" "}
            <span style={{ color: brand.fgSecondary }}>{expiresLabel}</span>.
            If you weren't expecting this, you can ignore it.
          </Text>
          <Text
            style={{
              fontFamily: brand.mono,
              fontSize: "11px",
              color: brand.fgTertiary,
              margin: 0,
            }}
          >
            <Link
              href={appBaseUrl}
              style={{ color: brand.fgTertiary, textDecoration: "underline" }}
            >
              claudemesh.com
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

MeshInvitation.PreviewProps = {
  meshName: "prueba1",
  inviteUrl: "https://claudemesh.com/i/RUVMYXZQ",
  token: "eyJ2IjoxLCJtZXNoX2lkIjoiQUtMYUZxR3FKOGZCajN0U3dvVk1PSFYxQmF3UGlYTE8iLCJtZXNoX3NsdWciOiJwcnVlYmExIn0",
  expiresAt: "2026-04-22T00:51:26.181Z",
  appBaseUrl: "https://claudemesh.com",
} satisfies MeshInvitationProps;

export default MeshInvitation;

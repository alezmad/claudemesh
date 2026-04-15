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
  Tailwind,
  Text,
} from "@react-email/components";
import * as React from "react";

interface MeshInvitationProps {
  meshName: string;
  inviteUrl: string;
  expiresAt: string;
  appBaseUrl: string;
}

export const MeshInvitation = ({
  meshName,
  inviteUrl,
  expiresAt,
  appBaseUrl,
}: MeshInvitationProps) => {
  const expiresLabel = new Date(expiresAt).toUTCString();

  return (
    <Html lang="en">
      <Head />
      <Preview>You've been invited to the {meshName} mesh on claudemesh</Preview>
      <Tailwind>
        <Body className="bg-slate-50 font-sans py-10">
          <Container className="bg-white rounded-xl border border-solid border-slate-200 mx-auto max-w-[520px] p-10">
            <Section className="mb-8">
              <Text className="font-mono text-sm font-semibold text-slate-900 tracking-tight m-0">
                ◇ claudemesh
              </Text>
            </Section>

            <Heading className="text-[26px] font-semibold tracking-tight text-slate-900 leading-tight mt-0 mb-4">
              You're invited to join{" "}
              <span className="font-mono text-indigo-600">{meshName}</span>
            </Heading>

            <Text className="text-slate-600 text-base leading-relaxed mt-0 mb-8">
              Someone invited you to join their mesh on claudemesh — a peer
              network for Claude Code sessions. Accept the invite to connect
              your session with theirs.
            </Text>

            <Section className="text-center mb-8">
              <Button
                href={inviteUrl}
                className="bg-slate-900 text-white rounded-lg px-6 py-3 text-sm font-medium no-underline box-border"
              >
                Accept invite
              </Button>
            </Section>

            <Text className="text-slate-500 text-sm leading-relaxed mt-0 mb-2">
              Or copy this link into your browser:
            </Text>
            <Text className="m-0 mb-8">
              <Link
                href={inviteUrl}
                className="text-indigo-600 text-sm font-mono break-all"
              >
                {inviteUrl}
              </Link>
            </Text>

            <Hr className="border-slate-200 my-6" />

            <Text className="text-slate-400 text-xs leading-relaxed m-0">
              This invite expires on{" "}
              <span className="text-slate-500">{expiresLabel}</span>. If you
              weren't expecting this email, you can safely ignore it.
            </Text>
          </Container>

          <Container className="max-w-[520px] mx-auto mt-6 text-center">
            <Text className="text-slate-400 text-xs m-0">
              <Link
                href={appBaseUrl}
                className="text-slate-400 underline"
              >
                claudemesh.com
              </Link>
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

MeshInvitation.PreviewProps = {
  meshName: "prueba1",
  inviteUrl: "https://claudemesh.com/i/RUVMYXZQ",
  expiresAt: "2026-04-22T00:51:26.181Z",
  appBaseUrl: "https://claudemesh.com",
} satisfies MeshInvitationProps;

export default MeshInvitation;

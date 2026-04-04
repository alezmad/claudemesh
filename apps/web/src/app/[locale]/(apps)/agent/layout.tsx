import { getMetadata } from "~/lib/metadata";
import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";

export const generateMetadata = getMetadata({
  title: "ai:agent.title",
  description: "ai:agent.description",
});

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          <ThemeSwitcher />
        </div>
      </Header>
      <div className="@container relative flex h-full flex-col items-center contain-layout">
        {children}
      </div>
    </>
  );
}

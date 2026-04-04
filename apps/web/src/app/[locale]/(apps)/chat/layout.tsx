import { getMetadata } from "~/lib/metadata";
import { ChatHistory } from "~/modules/chat/history";
import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";

export const generateMetadata = getMetadata({
  title: "ai:chat.title",
  description: "ai:chat.description",
});

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          <ChatHistory />
          <ThemeSwitcher />
        </div>
      </Header>

      <div className="@container relative flex h-full flex-col items-center contain-layout">
        {children}
      </div>
    </>
  );
}

import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";
import { RecentChats } from "~/modules/pdf/components/recent-chats";
import { ChatHistory } from "~/modules/pdf/history";
import { PdfUpload } from "~/modules/pdf/upload";

export default function PdfPage() {
  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          <ChatHistory />
          <ThemeSwitcher />
        </div>
      </Header>
      <div className="flex h-full w-full flex-col items-center overflow-y-auto p-3 pt-12 md:pt-14">
        <PdfUpload />
        <RecentChats />
      </div>
    </>
  );
}

import { getMetadata } from "~/lib/metadata";
import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";
import { History } from "~/modules/image/history";

export const generateMetadata = getMetadata({
  title: "ai:image.history.title",
  description: "ai:image.history.description",
});

export default function HistoryPage() {
  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          <ThemeSwitcher />
        </div>
      </Header>

      <History />
    </>
  );
}

import { useEffect } from "react";
import { setDocumentPageTitle } from "../../utils/pageTitle";
import { PageHeader } from "./PageHeader";

type ShellPageProps = {
  title: string;
};

/** Simple main-area placeholder until real module pages exist. */
export function ShellPage({ title }: ShellPageProps) {
  useEffect(() => {
    setDocumentPageTitle(title);
  }, [title]);

  return (
    <main className="mainLayout__content">
      <PageHeader title={title} subtitle="In Progress" />
    </main>
  );
}

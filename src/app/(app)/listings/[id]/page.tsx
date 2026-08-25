import { ListingDetail } from "@/components/listings/listing-detail";

export default async function ListingDetailPage({
  params,
}: PageProps<"/listings/[id]">) {
  const { id } = await params;
  return <ListingDetail id={id} />;
}

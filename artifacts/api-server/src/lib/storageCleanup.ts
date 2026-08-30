type ListingStorageReference = {
  images: string[] | null;
};

type AdStorageReference = {
  image: string | null;
  videoPath: string | null;
};

type VendorStorageReference = {
  profilePhoto: string | null;
};

function addObjectPath(paths: Set<string>, value: string | null | undefined): void {
  if (value?.startsWith("/objects/")) {
    paths.add(value);
  }
}

export function collectReferencedObjectPaths({
  listings,
  ads,
  vendors,
}: {
  listings: ListingStorageReference[];
  ads: AdStorageReference[];
  vendors: VendorStorageReference[];
}): Set<string> {
  const paths = new Set<string>();

  for (const listing of listings) {
    for (const image of listing.images ?? []) {
      addObjectPath(paths, image);
    }
  }

  for (const ad of ads) {
    addObjectPath(paths, ad.image);
    addObjectPath(paths, ad.videoPath);
  }

  for (const vendor of vendors) {
    addObjectPath(paths, vendor.profilePhoto);
  }

  return paths;
}
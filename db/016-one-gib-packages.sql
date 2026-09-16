ALTER TABLE bridge_packages DROP CONSTRAINT bridge_packages_size_check;
ALTER TABLE bridge_packages ADD CONSTRAINT bridge_packages_size_check CHECK (size >= 0 AND size <= 1073741824);
ALTER TABLE bridge_package_chunks DROP CONSTRAINT bridge_package_chunks_part_check;
ALTER TABLE bridge_package_chunks ADD CONSTRAINT bridge_package_chunks_part_check CHECK (part >= 0 AND part < 4096);
